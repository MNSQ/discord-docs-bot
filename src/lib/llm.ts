import { type Chunk } from './rag';

const BASE_URL       = () => (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
const MODEL          = () => process.env.OLLAMA_MODEL ?? 'qwen3:4b';
const GATEWAY_SECRET = () => process.env.OLLAMA_GATEWAY_SECRET;

const TIMEOUT_MS = 30_000;

export const REFUSAL = 'I could not find this in the available documentation.';

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the documentation assistant for a Discord server. You answer only from the provided documentation chunks.

Rules:
- Read all provided chunks before answering.
- Combine the useful information into one clear answer.
- Do not copy one chunk verbatim.
- Do not start with a broken fragment.
- If a chunk begins mid-sentence, silently repair the flow or ignore that fragment.
- If the question is broad, give a broad explanation using all relevant chunks.
- If the question is specific, answer directly.
- If the docs do not contain the answer, say: "${REFUSAL}"
- Do not invent facts outside the docs.
- Do not mention chunks, retrieval, context, or internal processing.
- Do not include source URLs in the answer; the app adds sources separately.
- Output only the final answer.`;

function buildUserMessage(question: string, chunks: Chunk[]): string {
  const blocks = markFragmentStarts(chunks)
    .map((c, i) => {
      const title  = c.title     ?? 'Untitled';
      const source = c.source_url ?? 'unknown';
      return `[${i + 1}] Title: ${title}\nSource: ${source}\nContent:\n${c.content}`;
    })
    .join('\n\n');

  const capped = blocks.length > 5000 ? blocks.slice(0, 5000) + '\n…' : blocks;

  return [
    `Question:\n${question}`,
    `Documentation:\n${capped}`,
    'Now write the best possible answer using only the documentation above.',
    'Answer style:\n- For "tell me about X", "what is X", or "explain X": write 1–3 solid paragraphs.\n- For setup/configuration questions: use clear steps.\n- For comparisons or lists: use bullets.\n- Keep the answer concise but useful.\n- Prefer natural explanation over raw documentation wording.',
  ].join('\n\n');
}

// ─── Fragment detection ───────────────────────────────────────────────────────

function markFragmentStarts(chunks: Chunk[]): Chunk[] {
  return chunks.map(c => {
    const trimmed = c.content.trimStart();
    if (/^[a-z]/.test(trimmed)) return { ...c, content: '…' + trimmed };
    return c;
  });
}

// ─── Answer extraction ────────────────────────────────────────────────────────

// Strips <think>...</think> blocks that Qwen3 can produce when thinking bleeds through.
function stripThinkingBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// Tolerant extraction: prefers JSON (any key), falls back to plain text.
function extractAnswer(raw: string): string {
  // 1. Strip thinking blocks
  let text = stripThinkingBlocks(raw);

  // 2. Strip Markdown code fences
  text = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // 3. Try to parse as JSON
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['answer', 'content', 'message', 'response', 'text', 'result']) {
      const val = parsed[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    // Parsed but no recognised key — fall through to plain text
  } catch {
    // Not JSON
  }

  // 4. Try to extract embedded JSON object containing a known key
  const embedded = text.match(/\{[\s\S]*?"(?:answer|content|response|text)"[\s\S]*?\}/);
  if (embedded) {
    try {
      const parsed = JSON.parse(embedded[0]) as Record<string, unknown>;
      for (const key of ['answer', 'content', 'response', 'text']) {
        const val = parsed[key];
        if (typeof val === 'string' && val.trim()) return val.trim();
      }
    } catch {
      // Ignore
    }
  }

  // 5. Plain text — strip any "Answer:" prefix the model may have added
  text = text.replace(/^(?:final\s+)?answer\s*[:：]\s*/i, '').trim();

  return text;
}

// ─── Rejection checks ─────────────────────────────────────────────────────────

// Rejects only for genuine failures — empty output, un-stripped thinking tags,
// or an explicit "Reasoning:" bleed-through. Does NOT reject for minor formatting.
function isRejectable(answer: string): { reject: boolean; reason: string } {
  if (!answer) {
    return { reject: true, reason: 'empty answer' };
  }
  if (/<think>/i.test(answer)) {
    return { reject: true, reason: 'contains un-stripped <think> tag' };
  }
  if (/^Reasoning\s*:/im.test(answer)) {
    return { reject: true, reason: 'starts with Reasoning: bleed-through' };
  }
  return { reject: false, reason: '' };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateAnswer(
  question: string,
  chunks: Chunk[],
): Promise<string | null> {
  const model     = MODEL();
  const baseUrl   = BASE_URL();
  const url       = `${baseUrl}/api/chat`;
  const sourceUrl = chunks[0]?.source_url ?? null;

  const hostname = (() => {
    try { return new URL(baseUrl).hostname; } catch { return baseUrl; }
  })();

  console.log('[LLM] request started');
  console.log('[LLM] gateway:', hostname);
  console.log('[LLM] model:', model);
  console.log('[LLM] chunks:', chunks.length, '| best source:', sourceUrl ?? 'none');

  const startMs = Date.now();

  try {
    const secret  = GATEWAY_SECRET();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method:  'POST',
      headers,
      signal:  controller.signal,
      body: JSON.stringify({
        model,
        stream:  false,
        think:   false,
        // No format: "json" — plain text output is more reliable than constrained
        // JSON decoding when the model may pick a different key or emit preamble.
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

    clearTimeout(timer);
    const durationMs = Date.now() - startMs;

    if (!res.ok) {
      const body = await res.text();
      console.error(`[LLM] request failed with error: HTTP ${res.status} — ${body}`);
      return null;
    }

    const data = await res.json() as {
      message?: { content?: string; thinking?: string };
    };

    const raw = (data?.message?.content ?? '').trim();
    console.log('[LLM] raw response length:', raw.length);

    if (!raw) {
      console.error('[LLM] request failed with error: empty content from model');
      return null;
    }

    const answer = extractAnswer(raw);
    console.log('[LLM] parsed answer length:', answer.length);

    const { reject, reason } = isRejectable(answer);
    if (reject) {
      console.warn('[LLM] parse failed with error: rejected —', reason);
      return null;
    }

    // Return refusal as-is (no source link appended)
    if (answer.includes(REFUSAL)) {
      console.log(`[LLM] refusal | ${durationMs}ms`);
      return REFUSAL;
    }

    // Append best source URL if not already present
    let final = answer;
    if (sourceUrl && !answer.includes(sourceUrl)) {
      final = `${answer}\n\nFor more information, check: ${sourceUrl}`;
    }

    // Discord hard limit
    if (final.length > 1900) final = final.slice(0, 1897) + '…';

    console.log(`[LLM] success | ${durationMs}ms | ${final.length} chars`);
    return final;

  } catch (err) {
    const durationMs = Date.now() - startMs;
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[LLM] request failed with error: timed out after ${TIMEOUT_MS / 1000}s (${durationMs}ms)`);
    } else {
      console.error(`[LLM] request failed with error (${durationMs}ms):`, err);
    }
    return null;
  }
}
