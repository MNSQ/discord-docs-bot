import { type Chunk } from './rag';

const BASE_URL       = () => (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
const MODEL          = () => process.env.OLLAMA_MODEL ?? 'qwen3:4b';
const GATEWAY_SECRET = () => process.env.OLLAMA_GATEWAY_SECRET;

const TIMEOUT_MS = 30_000;

export const REFUSAL = 'I could not find this in the available documentation.';

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Discord documentation assistant. Answer only from the provided documentation.

Your first sentence must be the answer itself. Do not start with meta commentary.
Forbidden openings: "We are given", "I need to", "Let me", "The question", "The user", "From the documentation", "Section", "We have to", "First, note".

Never mention section numbers like [1], [2], [3]. Do not reference sections or chunks at all.
Do not show your reasoning or analysis. Write the final answer directly.

Silently treat "ionet", "io net", "IONET", and "IO.NET" as the same project. Use "io.net" as the canonical name.

If the documentation does not contain the answer, say: "${REFUSAL}"

For broad questions like "tell me about io.net", write 1–3 useful paragraphs.
For setup or configuration questions, use clear steps.
For specific questions, answer directly and concisely.

Return only the final plain text answer. No JSON.`;

const RETRY_SUFFIX_MESSAGE =
  'Your previous response included analysis or section references. ' +
  'Return only the final user-facing answer. ' +
  'Do not mention the question, sections, documentation chunks, reasoning, or your process. ' +
  'Start directly with the answer.';

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
    'Answer the question using only the documentation above. Do not mention section numbers, analysis, or reasoning.',
  ].join('\n\n');
}

// ─── Cleaning ─────────────────────────────────────────────────────────────────

export function cleanAnswer(raw: string): string {
  let t = raw ?? '';

  // Step 1: discard everything before the last </think> (Qwen3 reasoning prefix)
  const lastClose = t.lastIndexOf('</think>');
  const strippedThink = lastClose !== -1;
  if (strippedThink) t = t.slice(lastClose + '</think>'.length);
  console.log('[LLM] stripped thinking prefix:', strippedThink);

  // Step 2: remove any remaining paired <think>...</think> blocks
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // Step 3: unwrap Markdown code fences (keep inner text)
  t = t.replace(/```(?:\w+)?\s*([\s\S]*?)```/g, '$1');

  // Step 4: strip leading "Answer:" prefix the model may add
  t = t.replace(/^(?:final\s+)?answer\s*[:：]\s*/i, '');

  return t.trim();
}

// ─── Untagged reasoning sanitiser ────────────────────────────────────────────

const REASONING_PREFIXES = [
  // Explicit analysis openers
  'let me analyze',
  'i need to analyze',
  'i need to',
  'i should',
  "i'll craft",
  'looking through',
  'looking at',
  // "We" phrasing the model uses when it leaks prompt-following reasoning
  'we are given',
  'we have to',
  // Section/chunk references
  'section [',
  'from section',
  'the most relevant section',
  'key points from the documentation',
  // "The question / user" meta-commentary
  'the question is',
  'the question asks',
  'the user asks',
  'the user is asking',
  // Documentation meta-references
  'from the provided documentation',
  'based on the documentation sections',
  'based on the provided documentation',
  // Process commentary
  'first, note that',
  'the final answer',
  'final answer:',
];

function isReasoningParagraph(para: string): boolean {
  const lower = para.trim().toLowerCase();
  if (REASONING_PREFIXES.some(p => lower.startsWith(p))) return true;
  // Paragraph starting with a bare section reference like "[1]", "[2] ..."
  if (/^\[\d+\]/.test(para.trim())) return true;
  return false;
}

export function sanitizeFinalAnswer(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) {
    throw new Error('[LLM] rejection reason: reasoning leak without clean final answer');
  }

  // Fast path: no reasoning in first paragraph
  if (!isReasoningParagraph(paragraphs[0])) return text;

  const clean = paragraphs.filter(p => !isReasoningParagraph(p));
  if (clean.length === 0) {
    throw new Error('[LLM] rejection reason: reasoning leak without clean final answer');
  }

  console.log('[LLM] sanitized reasoning leak: stripped', paragraphs.length - clean.length, 'paragraph(s)');
  return clean.join('\n\n');
}

// ─── Intent-aware source selection ───────────────────────────────────────────

function chooseBestSource(
  question: string,
  chunks: Chunk[],
  defaultSource: string | null,
): string | null {
  const q = question.toLowerCase();

  // Collect unique source URLs in the order chunks were selected
  const seen = new Set<string>();
  const candidates = chunks
    .filter(c => c.source_url && !seen.has(c.source_url) && (seen.add(c.source_url), true))
    .map(c => ({ url: c.source_url!, text: `${c.title ?? ''} ${c.source_url ?? ''}`.toLowerCase() }));

  console.log(
    '[source] candidates:',
    candidates.map(c => c.url).join(' | ') || '(none)',
  );

  if (candidates.length === 0) {
    console.log('[source] rejected reason: no source URLs in selected chunks');
    return null;
  }

  const isVm         = /\bvm\b|virtual.machine|on.?demand|cloud.?vm|deploy.?vm|spin.?up|cloud.?instance/.test(q);
  const isTokenomics = /\btoken|tokenomics|emission|staking|supply\b|coin\b|vesting|airdrop|\breward/.test(q);
  const isIntelligence = /io.?intelligence|ai.?access|\bmodels?\b|api.?key|inference/.test(q);
  const isInstall    = /\binstall|ubuntu|hiveos|worker.?setup|set.?up.?worker|add.?worker/.test(q);

  const INSTALL_SIGNALS = ['ubuntu', 'hiveos', 'install-worker', 'worker-setup', 'nvidia', 'install-on', 'run-worker'];

  if (isVm) {
    const ACCEPT = ['vm', 'virtual-machine', 'deploy-vm', 'on-demand', 'cloud'];
    const REJECT = ['staking', 'tokenomics', 'co-staking', 'emission', ...INSTALL_SIGNALS];
    for (const c of candidates) {
      if (ACCEPT.some(s => c.text.includes(s)) && !REJECT.some(s => c.text.includes(s))) {
        console.log('[source] selected (vm intent):', c.url);
        return c.url;
      }
    }
    console.log('[source] rejected reason: no VM-relevant source among candidates');
    return null;
  }

  if (isTokenomics) {
    const ACCEPT = ['tokenomics', 'token', 'emission', 'staking', 'coin', 'supply', 'vesting', 'airdrop', 'monthly'];
    const REJECT = [...INSTALL_SIGNALS];
    for (const c of candidates) {
      if (ACCEPT.some(s => c.text.includes(s)) && !REJECT.some(s => c.text.includes(s))) {
        console.log('[source] selected (tokenomics intent):', c.url);
        return c.url;
      }
    }
    // No tokenomics-specific source — fall through to default
  }

  if (isIntelligence) {
    const ACCEPT = ['intelligence', 'ai-access', 'models', 'api-key', 'inference', 'payment', 'rate'];
    const REJECT = ['staking', 'tokenomics', ...INSTALL_SIGNALS];
    for (const c of candidates) {
      if (ACCEPT.some(s => c.text.includes(s)) && !REJECT.some(s => c.text.includes(s))) {
        console.log('[source] selected (intelligence intent):', c.url);
        return c.url;
      }
    }
    // Fall through to default
  }

  // For non-install questions, refuse to link to install/worker-setup pages
  if (!isInstall && defaultSource) {
    if (INSTALL_SIGNALS.some(s => defaultSource.toLowerCase().includes(s))) {
      const fallback = candidates.find(c => !INSTALL_SIGNALS.some(s => c.text.includes(s)));
      if (fallback) {
        console.log('[source] selected (fallback, avoiding install doc):', fallback.url);
        return fallback.url;
      }
      console.log('[source] rejected reason: default is install doc and no alternative found');
      return null;
    }
  }

  console.log('[source] selected (default):', defaultSource ?? '(none)');
  return defaultSource;
}

// ─── Ollama fetch helper ──────────────────────────────────────────────────────
// Makes one request, returns cleaned + sanitized answer text.
// Throws on every failure path so the caller can decide whether to retry.

type OllamaMessage = { role: string; content: string };

async function fetchAndClean(
  url: string,
  headers: Record<string, string>,
  model: string,
  messages: OllamaMessage[],
  attempt: number,
): Promise<string> {
  console.log(`[LLM] attempt ${attempt}: sending ${messages.length}-message conversation`);

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

  console.log(`[LLM] attempt ${attempt}: HTTP status ${res.status}`);

  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable)');
    throw new Error(`[LLM] HTTP ${res.status} — ${body}`);
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`[LLM] could not parse gateway response — ${err}`);
  }

  console.log(`[LLM] attempt ${attempt}: response keys =`, Object.keys(data).join(', '));

  const msg = data.message;
  const chatContent =
    msg !== null && typeof msg === 'object'
      ? ((msg as Record<string, unknown>).content ?? '')
      : '';

  const rawText =
    typeof chatContent === 'string' && chatContent.trim()
      ? chatContent
      : typeof data.response === 'string' && (data.response as string).trim()
      ? (data.response as string)
      : '';

  console.log(`[LLM] attempt ${attempt}: raw length =`, rawText.length);

  if (!rawText.trim()) {
    throw new Error(
      `[LLM] empty content — message.content="${String(chatContent)}" response="${String(data.response ?? '')}"`,
    );
  }

  const cleaned = cleanAnswer(rawText);
  console.log(`[LLM] attempt ${attempt}: cleaned length =`, cleaned.length);

  if (!cleaned.trim()) throw new Error('[LLM] rejection reason: cleaned answer is empty');
  if (/<\/?think\b/i.test(cleaned)) throw new Error('[LLM] rejection reason: residual <think> tag');
  if (/^Reasoning\s*:/im.test(cleaned)) throw new Error('[LLM] rejection reason: Reasoning: bleed-through');

  // May throw "[LLM] rejection reason: reasoning leak without clean final answer"
  return sanitizeFinalAnswer(cleaned);
}

// ─── Main export ──────────────────────────────────────────────────────────────
// Throws on unrecoverable failures. Retries once on reasoning-leak errors.

export async function generateAnswer(
  question: string,
  chunks: Chunk[],
  bestSource: string | null,
): Promise<string> {
  const model   = MODEL();
  const baseUrl = BASE_URL();
  const url     = `${baseUrl}/api/chat`;

  const hostname = (() => {
    try { return new URL(baseUrl).hostname; } catch { return baseUrl; }
  })();

  console.log('[LLM] request started');
  console.log('[LLM] gateway:', hostname);
  console.log('[LLM] model:', model);
  console.log('[LLM] chunks:', chunks.length, '| rag best source:', bestSource ?? 'none');

  const secret  = GATEWAY_SECRET();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['Authorization'] = `Bearer ${secret}`;

  const startMs = Date.now();

  const baseMessages: OllamaMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: buildUserMessage(question, chunks) },
  ];

  // ── Attempt 1 ─────────────────────────────────────────────────────────────
  let answer: string;
  try {
    answer = await fetchAndClean(url, headers, model, baseMessages, 1);
    console.log('[LLM] attempt 1 succeeded');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isReasoningLeak = msg.includes('reasoning leak');

    if (!isReasoningLeak) {
      throw err; // network/HTTP/empty failures — no point retrying
    }

    // ── Attempt 2: stricter prompt ─────────────────────────────────────────
    console.warn('[LLM] attempt 1 reasoning leak:', msg);
    console.log('[LLM] retrying with stricter prompt');

    const retryMessages: OllamaMessage[] = [
      ...baseMessages,
      { role: 'assistant', content: '(analysis omitted)' },
      { role: 'user',      content: RETRY_SUFFIX_MESSAGE },
    ];

    try {
      answer = await fetchAndClean(url, headers, model, retryMessages, 2);
      console.log('[LLM] attempt 2 (retry) succeeded');
    } catch (retryErr) {
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new Error(`[LLM] retry also failed: ${retryMsg}`);
    }
  }

  const durationMs = Date.now() - startMs;

  // ── Refusal ────────────────────────────────────────────────────────────────
  if (answer.includes(REFUSAL)) {
    console.log(`[LLM] refusal | ${durationMs}ms`);
    return REFUSAL;
  }

  // ── Intent-aware source selection ──────────────────────────────────────────
  const sourceUrl = chooseBestSource(question, chunks, bestSource);

  let final = answer;
  if (sourceUrl && !answer.includes(sourceUrl)) {
    final = `${answer}\n\nFor more information, check: ${sourceUrl}`;
  }

  if (final.length > 1900) final = final.slice(0, 1897) + '…';

  console.log(`[LLM] success | ${durationMs}ms | ${final.length} chars`);
  return final;
}
