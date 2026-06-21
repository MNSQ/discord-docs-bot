import { type Chunk } from './rag';

const BASE_URL       = () => (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
const MODEL          = () => process.env.OLLAMA_MODEL ?? 'qwen3:4b';
const GATEWAY_SECRET = () => process.env.OLLAMA_GATEWAY_SECRET;

const TIMEOUT_MS  = 30_000;
const FINAL_MARKER = 'FINAL_ANSWER:';

export const REFUSAL = 'I could not find this in the available documentation.';

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Discord documentation assistant. Answer only from the provided documentation.

Your first sentence must be the answer itself. Forbidden openings: "We are given", "We have", "We must", "I need to", "Let me", "The question", "The user", "From the documentation", "Section", "First, note", "Key points".

Never mention section numbers like [1], [2], [3]. Do not reference sections or chunks at all.
Do not show reasoning. Do not describe your process.

Silently treat "ionet", "io net", "IONET", and "IO.NET" as the same project. Use "io.net" as the canonical name.

If the documentation does not contain the answer, say: "${REFUSAL}"

For broad questions, write 1–3 useful paragraphs. For specific questions, answer directly.

Return your final user-facing answer ONLY after this exact marker on its own line:

${FINAL_MARKER}

Do not write anything before ${FINAL_MARKER}. Do not include the marker itself in your answer.`;

const RETRY_USER_MESSAGE =
  `Your previous response included analysis or section references instead of a direct answer.\n\n` +
  `Return ONLY this format — nothing else:\n\n` +
  `${FINAL_MARKER}\n` +
  `<the final user-facing answer here>\n\n` +
  `No analysis. No section numbers. No explanation of your process. The answer starts immediately after ${FINAL_MARKER}.`;

// ─── Fragment detection ───────────────────────────────────────────────────────

function markFragmentStarts(chunks: Chunk[]): Chunk[] {
  return chunks.map(c => {
    const trimmed = c.content.trimStart();
    if (/^[a-z]/.test(trimmed)) return { ...c, content: '…' + trimmed };
    return c;
  });
}

// ─── User message ─────────────────────────────────────────────────────────────

const MAX_CHUNK_CHARS = 1000;
const MAX_CHUNKS      = 5;

function buildUserMessage(question: string, chunks: Chunk[]): string {
  const sections = markFragmentStarts(chunks.slice(0, MAX_CHUNKS)).map((c, i) => {
    const title   = c.title      ?? 'Untitled';
    const source  = c.source_url ?? 'unknown';
    const content = c.content.length > MAX_CHUNK_CHARS
      ? c.content.slice(0, MAX_CHUNK_CHARS) + '…'
      : c.content;
    return `[${i + 1}] Title: ${title}\nSource: ${source}\nContent:\n${content}`;
  });

  const promptChars = sections.reduce((n, s) => n + s.length, 0);
  console.log('[LLM] prompt doc chars:', promptChars, '| chunks used:', sections.length);

  return [
    `Question:\n${question}`,
    `Documentation:\n${sections.join('\n\n')}`,
    `Answer using only the documentation above.\n\n${FINAL_MARKER}\n<your answer here>`,
  ].join('\n\n');
}

// ─── Reasoning patterns ───────────────────────────────────────────────────────

const REASONING_PATTERNS: string[] = [
  'we have documentation',
  'we must answer',
  'we are given',
  'we have to answer',
  'we have to',
  'first, note',
  'from the provided documentation',
  'looking through',
  'let me analyze',
  "let's analyze",
  'i need to analyze',
  'i need to',
  'the question is',
  'the question asks',
  'the user asks',
  'the user is asking',
  'section [',
  'key points from',
  "let's structure",
  'now write',
  'final answer:',     // catches "Final answer: ..." (lower-case, not our ALL-CAPS marker)
  'based on section',
  'documentation sections',
];

export function detectReasoning(text: string): boolean {
  const sample = text.slice(0, 1200).toLowerCase();
  if (REASONING_PATTERNS.some(p => sample.includes(p))) return true;
  // Section references like [1], [2], [3] in first 1200 chars
  if (/\[\d+\]/.test(text.slice(0, 1200))) return true;
  return false;
}

// ─── Marker extraction ────────────────────────────────────────────────────────
// Takes raw model output (after think-block stripping) and returns text after
// the LAST occurrence of FINAL_MARKER. Also returns whether the marker was found.

export function extractFinalAnswer(raw: string): { text: string; markerFound: boolean } {
  const idx = raw.lastIndexOf(FINAL_MARKER);
  if (idx !== -1) {
    return { text: raw.slice(idx + FINAL_MARKER.length).trim(), markerFound: true };
  }
  return { text: raw.trim(), markerFound: false };
}

// ─── Think-block stripping ────────────────────────────────────────────────────
// Exported so tests and the debug route can call it independently.

export function stripThinkBlocks(raw: string): { text: string; strippedThink: boolean } {
  let t = raw ?? '';

  // Discard everything before the last </think> (Qwen3 extended-thinking prefix)
  const lastClose = t.lastIndexOf('</think>');
  const strippedThink = lastClose !== -1;
  if (strippedThink) t = t.slice(lastClose + '</think>'.length);

  // Remove any fully paired <think>...</think> blocks
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');

  return { text: t.trim(), strippedThink };
}

// ─── cleanAnswer (exported for debug route) ───────────────────────────────────
// Applies all text-level cleaning to an already-extracted answer snippet.
// Does NOT strip FINAL_MARKER (caller has already extracted past it).

export function cleanAnswer(text: string): string {
  let t = text;
  // Unwrap Markdown code fences (keep inner text)
  t = t.replace(/```(?:\w+)?\s*([\s\S]*?)```/g, '$1');
  // Strip leading "Answer:" prefix the model may add even after the marker
  t = t.replace(/^(?:final\s+)?answer\s*[:：]\s*/i, '');
  return t.trim();
}

// ─── Full processing pipeline ─────────────────────────────────────────────────
// Used by both attempts so the logic stays in one place.

interface ProcessResult {
  answer:           string;
  markerFound:      boolean;
  strippedThink:    boolean;
  reasoningDetected: boolean;
}

export function processModelOutput(raw: string): ProcessResult {
  // 1. Strip think blocks
  const { text: thinkStripped, strippedThink } = stripThinkBlocks(raw);
  console.log('[LLM] stripped thinking prefix:', strippedThink);

  // 2. Extract after FINAL_MARKER (uses lastIndexOf so repeated markers work)
  const { text: extracted, markerFound } = extractFinalAnswer(thinkStripped);
  console.log('[LLM] final marker found:', markerFound);

  // 3. Clean the extracted portion
  const answer = cleanAnswer(extracted);

  // 4. Detect reasoning in first 1200 chars of the extracted/cleaned answer
  const reasoningDetected = detectReasoning(answer);
  console.log('[LLM] reasoning detected before final answer:', reasoningDetected);

  return { answer, markerFound, strippedThink, reasoningDetected };
}

// ─── Intent-aware source selection ───────────────────────────────────────────

function chooseBestSource(
  question: string,
  chunks: Chunk[],
  defaultSource: string | null,
): string | null {
  const q = question.toLowerCase();

  const seen = new Set<string>();
  const candidates = chunks
    .filter(c => c.source_url && !seen.has(c.source_url) && (seen.add(c.source_url), true))
    .map(c => ({ url: c.source_url!, text: `${c.title ?? ''} ${c.source_url ?? ''}`.toLowerCase() }));

  console.log('[source] candidates:', candidates.map(c => c.url).join(' | ') || '(none)');

  if (candidates.length === 0) {
    console.log('[source] rejected reason: no source URLs in selected chunks');
    return null;
  }

  const isVm         = /\bvm\b|virtual.machine|on.?demand|cloud.?vm|deploy.?vm|spin.?up/.test(q);
  const isTokenomics = /\btoken|tokenomics|emission|staking|supply\b|coin\b|vesting|airdrop|\breward/.test(q);
  const isIntel      = /io.?intelligence|ai.?access|\bmodels?\b|api.?key|inference/.test(q);
  const isInstall    = /\binstall|ubuntu|hiveos|worker.?setup|set.?up.?worker|add.?worker/.test(q);

  const INSTALL_SIGNALS = ['ubuntu', 'hiveos', 'install-worker', 'worker-setup', 'nvidia', 'install-on', 'run-worker'];

  if (isVm) {
    const ACCEPT = ['vm', 'virtual-machine', 'deploy-vm', 'on-demand', 'cloud'];
    const REJECT = ['staking', 'tokenomics', 'co-staking', 'emission', ...INSTALL_SIGNALS];
    const match = candidates.find(c =>
      ACCEPT.some(s => c.text.includes(s)) && !REJECT.some(s => c.text.includes(s)),
    );
    if (match) { console.log('[source] selected (vm intent):', match.url); return match.url; }
    console.log('[source] rejected reason: no VM-relevant source among candidates');
    return null;
  }

  if (isTokenomics) {
    const ACCEPT = ['tokenomics', 'token', 'emission', 'staking', 'coin', 'supply', 'vesting', 'airdrop', 'monthly'];
    const REJECT = [...INSTALL_SIGNALS];
    const match = candidates.find(c =>
      ACCEPT.some(s => c.text.includes(s)) && !REJECT.some(s => c.text.includes(s)),
    );
    if (match) { console.log('[source] selected (tokenomics intent):', match.url); return match.url; }
  }

  if (isIntel) {
    const ACCEPT = ['intelligence', 'ai-access', 'models', 'api-key', 'inference', 'payment', 'rate'];
    const REJECT = ['staking', 'tokenomics', ...INSTALL_SIGNALS];
    const match = candidates.find(c =>
      ACCEPT.some(s => c.text.includes(s)) && !REJECT.some(s => c.text.includes(s)),
    );
    if (match) { console.log('[source] selected (intelligence intent):', match.url); return match.url; }
  }

  if (!isInstall && defaultSource) {
    if (INSTALL_SIGNALS.some(s => defaultSource.toLowerCase().includes(s))) {
      const fallback = candidates.find(c => !INSTALL_SIGNALS.some(s => c.text.includes(s)));
      if (fallback) { console.log('[source] selected (fallback, avoiding install):', fallback.url); return fallback.url; }
      console.log('[source] rejected reason: default is install doc and no alternative found');
      return null;
    }
  }

  console.log('[source] selected (default):', defaultSource ?? '(none)');
  return defaultSource;
}

// ─── Ollama fetch (one attempt) ───────────────────────────────────────────────

type OllamaMsg = { role: string; content: string };

async function fetchOllama(
  url: string,
  headers: Record<string, string>,
  model: string,
  messages: OllamaMsg[],
  attemptNum: number,
): Promise<string> {
  console.log(`[LLM] attempt ${attemptNum}: sending request`);

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers,
      signal:  controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        think:  false,
        options: { temperature: 0.1, num_predict: 1200, num_ctx: 8192 },
        messages,
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    const reason = err instanceof Error
      ? (err.name === 'AbortError' ? `timed out after ${TIMEOUT_MS / 1000}s` : err.message)
      : String(err);
    throw new Error(`[LLM] fetch failed — ${reason}`);
  }
  clearTimeout(timer);

  console.log(`[LLM] attempt ${attemptNum}: HTTP ${res.status}`);

  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable)');
    throw new Error(`[LLM] HTTP ${res.status} — ${body}`);
  }

  let data: Record<string, unknown>;
  try { data = (await res.json()) as Record<string, unknown>; }
  catch (err) { throw new Error(`[LLM] could not parse gateway JSON — ${err}`); }

  console.log(`[LLM] attempt ${attemptNum}: response keys =`, Object.keys(data).join(', '));

  const msg = data.message;
  const chatContent =
    msg !== null && typeof msg === 'object'
      ? ((msg as Record<string, unknown>).content ?? '')
      : '';

  const rawText =
    typeof chatContent === 'string' && chatContent.trim() ? chatContent
    : typeof data.response === 'string' && (data.response as string).trim() ? (data.response as string)
    : '';

  console.log(`[LLM] attempt ${attemptNum}: raw length =`, rawText.length);

  if (!rawText.trim()) {
    throw new Error(
      `[LLM] empty content — message.content="${String(chatContent)}" response="${String(data.response ?? '')}"`,
    );
  }

  return rawText;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateAnswer(
  question: string,
  chunks: Chunk[],
  bestSource: string | null,
): Promise<string> {
  const model   = MODEL();
  const baseUrl = BASE_URL();
  const url     = `${baseUrl}/api/chat`;
  const hostname = (() => { try { return new URL(baseUrl).hostname; } catch { return baseUrl; } })();

  console.log('[LLM] request started');
  console.log('[LLM] gateway:', hostname);
  console.log('[LLM] model:', model);
  console.log('[LLM] chunks:', chunks.length, '| rag best source:', bestSource ?? 'none');

  const secret  = GATEWAY_SECRET();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['Authorization'] = `Bearer ${secret}`;

  const startMs = Date.now();

  const baseMessages: OllamaMsg[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: buildUserMessage(question, chunks) },
  ];

  // ── Attempt 1 ─────────────────────────────────────────────────────────────
  let answer: string;
  {
    const raw1 = await fetchOllama(url, headers, model, baseMessages, 1);
    const { answer: a1, reasoningDetected, markerFound } = processModelOutput(raw1);

    if (reasoningDetected) {
      console.warn('[LLM] retrying due to reasoning leak (attempt 1 marker found:', markerFound, ')');

      // ── Attempt 2: stricter format instruction ─────────────────────────────
      const retryMessages: OllamaMsg[] = [
        ...baseMessages,
        { role: 'assistant', content: a1 || '(no clean answer)' },
        { role: 'user',      content: RETRY_USER_MESSAGE },
      ];

      const raw2 = await fetchOllama(url, headers, model, retryMessages, 2);
      const result2 = processModelOutput(raw2);

      console.log('[LLM] retry', result2.reasoningDetected ? 'rejected' : 'accepted');

      if (result2.reasoningDetected) {
        throw new Error('[LLM] rejection reason: reasoning leak after retry');
      }
      if (!result2.answer.trim()) {
        throw new Error('[LLM] rejection reason: retry produced empty answer');
      }

      answer = result2.answer;
    } else {
      if (!a1.trim()) throw new Error('[LLM] rejection reason: empty answer after processing');
      answer = a1;
    }
  }

  const durationMs = Date.now() - startMs;

  // ── Residual tag guard ─────────────────────────────────────────────────────
  if (/<\/?think\b/i.test(answer)) {
    throw new Error('[LLM] rejection reason: residual <think> tag in final answer');
  }

  // ── Refusal ────────────────────────────────────────────────────────────────
  if (answer.includes(REFUSAL)) {
    console.log(`[LLM] refusal | ${durationMs}ms`);
    return REFUSAL;
  }

  // ── Source selection ───────────────────────────────────────────────────────
  const sourceUrl = chooseBestSource(question, chunks, bestSource);

  let final = answer;
  if (sourceUrl && !answer.includes(sourceUrl)) {
    final = `${answer}\n\nFor more information, check: ${sourceUrl}`;
  }

  if (final.length > 1900) final = final.slice(0, 1897) + '…';

  console.log(`[LLM] success | ${durationMs}ms | ${final.length} chars`);
  return final;
}
