import { type Chunk } from './rag';

const BASE_URL       = () => (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
const MODEL          = () => process.env.OLLAMA_MODEL ?? 'qwen3:4b';
const GATEWAY_SECRET = () => process.env.OLLAMA_GATEWAY_SECRET;

const TIMEOUT_MS = 30_000;

export const REFUSAL = 'I could not find this in the available documentation.';

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Discord documentation assistant. Answer only from the provided documentation.

Write the final answer directly. Do not show your analysis. Do not mention sections, chunks, retrieved documents, context, or internal reasoning.

Do not say "Let me analyze", "Looking through the documentation", "Section [1]", "From section", "Based on section", "The most relevant section", or similar.

Silently treat "ionet", "io net", "IONET", and "IO.NET" as the same project. Use "io.net" as the canonical name in the answer.

If the documentation does not contain the answer, say: "${REFUSAL}"

For broad questions like "tell me about io.net" or "what is io.net", write 1–3 useful paragraphs.
For setup or configuration questions, use clear steps.
For specific questions, answer directly and concisely.

Return only the final plain text answer. No JSON. No section analysis.`;

// ─── Fragment detection ───────────────────────────────────────────────────────

// Chunks starting with a lowercase letter are mid-sentence continuation
// fragments from a split across an abbreviation like "io.net". Mark them so
// the model does not open its answer with a broken fragment.
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
    'Write only the final answer. Do not include analysis or reasoning. Do not mention documentation section numbers.',
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
  'let me analyze',
  'i need to analyze',
  'looking through',
  'the question is asking',
  'i should',
  "i'll craft",
  'section [',
  'from section',
  'the most relevant section',
  'based on the documentation sections',
  'based on the provided documentation sections',
];

function isReasoningParagraph(para: string): boolean {
  const lower = para.trim().toLowerCase();
  return REASONING_PREFIXES.some(p => lower.startsWith(p));
}

export function sanitizeFinalAnswer(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  if (paragraphs.length === 0 || !isReasoningParagraph(paragraphs[0])) {
    return text; // no leak detected — pass through unchanged
  }

  const clean = paragraphs.filter(p => !isReasoningParagraph(p));
  if (clean.length === 0) {
    throw new Error('[LLM] rejection reason: reasoning leak without clean final answer');
  }

  console.log('[LLM] sanitized reasoning leak: stripped', paragraphs.length - clean.length, 'paragraph(s)');
  return clean.join('\n\n');
}

// ─── Main export ──────────────────────────────────────────────────────────────
// Throws an Error with a clear reason on every failure — never returns null.

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
  console.log('[LLM] chunks:', chunks.length, '| best source:', bestSource ?? 'none');

  const startMs = Date.now();
  const secret  = GATEWAY_SECRET();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['Authorization'] = `Bearer ${secret}`;

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // ── HTTP request ───────────────────────────────────────────────────────────
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
        // No format:"json" — plain text output only.
        options: { temperature: 0.1, num_predict: 1200, num_ctx: 8192 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: buildUserMessage(question, chunks) },
        ],
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    const ms     = Date.now() - startMs;
    const reason = err instanceof Error
      ? (err.name === 'AbortError' ? `timed out after ${TIMEOUT_MS / 1000}s` : err.message)
      : String(err);
    throw new Error(`[LLM] full error message: fetch failed — ${reason} (${ms}ms)`);
  }
  clearTimeout(timer);

  const durationMs = Date.now() - startMs;
  console.log('[LLM] HTTP status:', res.status);

  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable body)');
    throw new Error(`[LLM] full error message: HTTP ${res.status} from gateway — ${body}`);
  }

  // ── Parse gateway envelope ─────────────────────────────────────────────────
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`[LLM] full error message: could not parse gateway response as JSON — ${err}`);
  }

  console.log('[LLM] raw response keys:', Object.keys(data).join(', '));

  const msg        = data.message;
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

  console.log('[LLM] raw content length:', rawText.length);

  if (!rawText.trim()) {
    throw new Error(
      '[LLM] full error message: model returned empty content — ' +
      `message.content="${String(chatContent)}" | response="${String(data.response ?? '')}"`,
    );
  }

  // ── Clean ──────────────────────────────────────────────────────────────────
  const cleaned = cleanAnswer(rawText);
  console.log('[LLM] cleaned answer length:', cleaned.length);

  if (!cleaned.trim()) {
    throw new Error('[LLM] rejection reason: cleaned answer is empty after stripping');
  }
  if (/<\/?think\b/i.test(cleaned)) {
    throw new Error('[LLM] rejection reason: residual thinking tag after cleaning');
  }
  if (/^Reasoning\s*:/im.test(cleaned)) {
    throw new Error('[LLM] rejection reason: answer begins with "Reasoning:" bleed-through');
  }

  // ── Sanitise untagged reasoning ────────────────────────────────────────────
  const answer = sanitizeFinalAnswer(cleaned);

  // ── Refusal ────────────────────────────────────────────────────────────────
  if (answer.includes(REFUSAL)) {
    console.log(`[LLM] refusal | ${durationMs}ms`);
    return REFUSAL;
  }

  // ── Append best source URL ─────────────────────────────────────────────────
  let final = answer;
  if (bestSource && !answer.includes(bestSource)) {
    final = `${answer}\n\nFor more information, check: ${bestSource}`;
  }

  // Discord hard limit
  if (final.length > 1900) final = final.slice(0, 1897) + '…';

  console.log(`[LLM] success | ${durationMs}ms | ${final.length} chars`);
  return final;
}
