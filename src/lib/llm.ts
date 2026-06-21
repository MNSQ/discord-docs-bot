import { type Chunk } from './rag';

const BASE_URL       = () => (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
const MODEL          = () => process.env.OLLAMA_MODEL ?? 'qwen3:4b';
const GATEWAY_SECRET = () => process.env.OLLAMA_GATEWAY_SECRET;

const TIMEOUT_MS = 30_000;

export const REFUSAL = 'I could not find this in the available documentation.';

// ─── System prompt ────────────────────────────────────────────────────────────
// Plain text only. Never ask the model for JSON.

const SYSTEM_PROMPT = `You are a documentation assistant for a Discord server. Answer only using the provided documentation.

Read all provided documentation sections, combine the useful information, and write the best possible answer.

Do not copy one section verbatim.
Do not mention chunks, retrieval, context, or internal processing.
Do not include source URLs because the app adds sources separately.
If the documentation does not contain the answer, say: "${REFUSAL}"

For broad questions like "tell me about io.net" or "what is io.net", write 1–3 useful paragraphs.
For setup/configuration questions, use clear steps.
For specific questions, answer directly.

Return only the final plain text answer. No JSON.`;

// ─── Fragment detection ───────────────────────────────────────────────────────

// Chunks starting with a lowercase letter are mid-sentence continuation
// fragments (e.g. "net proposes..." from a split across "io.net"). Mark them
// so the model knows not to open the answer with a broken fragment.
function markFragmentStarts(chunks: Chunk[]): Chunk[] {
  return chunks.map(c => {
    const trimmed = c.content.trimStart();
    if (/^[a-z]/.test(trimmed)) return { ...c, content: '…' + trimmed };
    return c;
  });
}

// ─── User message ─────────────────────────────────────────────────────────────

function buildUserMessage(question: string, chunks: Chunk[]): string {
  const sections = markFragmentStarts(chunks).map((c, i) => {
    const title  = c.title      ?? 'Untitled';
    const source = c.source_url ?? 'unknown';
    return `[${i + 1}] Title: ${title}\nSource: ${source}\nContent:\n${c.content}`;
  });
  const docs   = sections.join('\n\n');
  const capped = docs.length > 5000 ? docs.slice(0, 5000) + '\n…' : docs;

  return `Question:\n${question}\n\nDocumentation:\n${capped}\n\nNow write the best possible answer.`;
}

// ─── Answer cleaning ──────────────────────────────────────────────────────────

function cleanAnswer(raw: string): string {
  let t = raw;
  // Strip <think>...</think> blocks Qwen3 may emit
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Strip Markdown code fences
  t = t.replace(/^```[\w]*\s*/i, '').replace(/\s*```\s*$/i, '');
  // Strip leading "Answer:" prefix the model may add
  t = t.replace(/^(?:final\s+)?answer\s*[:：]\s*/i, '');
  return t.trim();
}

// ─── Main export ──────────────────────────────────────────────────────────────
// Throws an Error with a clear reason on every failure path — never returns null.

export async function generateAnswer(
  question: string,
  chunks: Chunk[],
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

  const startMs   = Date.now();
  const secret    = GATEWAY_SECRET();
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
        options: {
          temperature: 0.1,
          num_predict: 1200,
          num_ctx:     8192,
        },
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

  // ── Parse gateway JSON envelope ────────────────────────────────────────────
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`[LLM] full error message: could not parse gateway response as JSON — ${err}`);
  }

  console.log('[LLM] raw response keys:', Object.keys(data).join(', '));

  // ── Extract model text ─────────────────────────────────────────────────────
  // Ollama /api/chat → data.message.content
  // Ollama /api/generate → data.response
  // Fallback: look for any top-level string value
  const msg = data.message;
  const rawFromChat =
    msg !== null && typeof msg === 'object'
      ? ((msg as Record<string, unknown>).content ?? '')
      : '';

  const rawText =
    typeof rawFromChat === 'string' && rawFromChat.trim()
      ? rawFromChat
      : typeof data.response === 'string' && (data.response as string).trim()
      ? (data.response as string)
      : '';

  console.log('[LLM] raw content length:', rawText.length);

  if (!rawText.trim()) {
    throw new Error(
      '[LLM] full error message: model returned empty content — ' +
      `message.content="${String(rawFromChat)}" | response="${String(data.response ?? '')}"`,
    );
  }

  // ── Clean the answer ───────────────────────────────────────────────────────
  const answer = cleanAnswer(rawText);
  console.log('[LLM] cleaned answer length:', answer.length);

  if (!answer) {
    throw new Error('[LLM] rejection reason: cleaned answer is empty after stripping');
  }
  if (/<think>/i.test(answer)) {
    throw new Error('[LLM] rejection reason: answer still contains <think> tag after stripping');
  }
  if (/^Reasoning\s*:/im.test(answer)) {
    throw new Error('[LLM] rejection reason: answer begins with "Reasoning:" bleed-through');
  }

  // ── Refusal ────────────────────────────────────────────────────────────────
  if (answer.includes(REFUSAL)) {
    console.log(`[LLM] refusal | ${durationMs}ms`);
    return REFUSAL;
  }

  // ── Append source URL ──────────────────────────────────────────────────────
  const sourceUrl = chunks[0]?.source_url ?? null;
  let final = answer;
  if (sourceUrl && !answer.includes(sourceUrl)) {
    final = `${answer}\n\nFor more information, check: ${sourceUrl}`;
  }

  // Discord 2000-char hard limit with headroom
  if (final.length > 1900) final = final.slice(0, 1897) + '…';

  console.log(`[LLM] success | ${durationMs}ms | ${final.length} chars`);
  return final;
}
