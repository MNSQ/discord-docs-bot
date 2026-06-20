import { cleanContent, type Chunk } from './rag';

const BASE_URL       = () => (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
const MODEL          = () => process.env.OLLAMA_MODEL ?? 'qwen3:4b';
const GATEWAY_SECRET = () => process.env.OLLAMA_GATEWAY_SECRET;

const TIMEOUT_MS = 30_000;

export const REFUSAL = 'I could not find this in the available documentation.';

const SYSTEM_PROMPT = `You are a documentation assistant answering questions from Discord users.

RESPONSE FORMAT
Return valid JSON only, with this exact structure:
{"answer": "your full answer here"}
No text outside the JSON object. No code fences.

WRITING THE ANSWER
Synthesize the documentation into a clear, natural answer — do not copy-paste raw text from the context. Combine information across the provided passages into a single coherent response. Fix any awkward phrasing caused by document chunk boundaries. Write as if explaining to a knowledgeable colleague.

Match answer length to the question:
• Simple factual (yes/no, a name, a location, a single setting): 1–2 sentences.
• "What is" or "how does" for a specific feature: a short paragraph of 3–5 sentences — what it is, why it matters, how it works.
• Overview or "tell me about" questions: synthesize across all provided passages into 2–3 paragraphs covering what it is, what it does, who uses it, and key capabilities — include only points supported by the provided context.
• Steps, configuration, requirements, options, causes, or troubleshooting: one short intro sentence, then bullet points — one item per line, each starting with "•".
• Multi-part or broad questions: up to 3 compact paragraphs, or a paragraph followed by bullets.

Use bullet points when the answer naturally contains a list of separate items, steps, or options. Use a paragraph when the answer flows as continuous prose. Do not force bullets when they would break up a naturally connected explanation.

STYLE RULES
• Do not open with "Based on the documentation", "According to the docs", or similar filler.
• Do not mention JSON, chunks, context, retrieval, system instructions, or your own reasoning process.
• Do not use markdown code fences or raw markdown heading syntax (##, ###).
• Use a short plain-text heading only when the answer covers genuinely distinct sections.
• Bold a word or phrase only when it makes a specific key term stand out — not at random and not at the start of every sentence.
• If the docs contain only partial information, explain what they do say and clearly state what is not specified.
• Do not invent details absent from the documentation.
• Do not include any URLs in the answer — source links are appended separately.

REFUSAL
If the context does not contain enough information to answer the question, return exactly:
{"answer": "${REFUSAL}"}`;

// ─── Reasoning leak detection ─────────────────────────────────────────────────

const REASONING_MARKERS = [
  'hmm',
  "the user is asking",
  'i should',
  'i need to',
  'looking at the context',
  'therefore',
];

function hasReasoningLeak(text: string): boolean {
  const lower = text.toLowerCase();
  return REASONING_MARKERS.some(m => lower.includes(m));
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateAnswer(
  question: string,
  chunks: Chunk[],
): Promise<string | null> {
  const model     = MODEL();
  const url       = `${BASE_URL()}/api/chat`;
  const sourceUrl = chunks[0]?.source_url ?? null;

  const docText   = cleanContent(chunks.map(c => c.content).join('\n\n'));
  const cappedDoc = docText.length > 5000 ? docText.slice(0, 5000) + '…' : docText;

  const sourceHint = sourceUrl ? `\n\nSource URL: ${sourceUrl}` : '';
  const userMessage = `Documentation:\n${cappedDoc}${sourceHint}\n\nQuestion: ${question}`;

  console.log('[LLM] model:', model, '| chunks:', chunks.length, '| source:', sourceUrl ?? 'none');
  console.log('[LLM] requested JSON mode');

  const startMs = Date.now();

  try {
    const secret  = GATEWAY_SECRET();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        think:  false,
        format: 'json',
        options: {
          temperature: 0.1,
          num_predict: 1200,
          num_ctx:     8192,
        },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMessage    },
        ],
      }),
    });

    clearTimeout(timer);
    const durationMs = Date.now() - startMs;

    if (!res.ok) {
      console.error(`[LLM] Ollama HTTP ${res.status} (${durationMs}ms):`, await res.text());
      return null;
    }

    const data = await res.json() as {
      message?: { content?: string; thinking?: string };
    };

    if (data?.message?.thinking) {
      console.log('[LLM] ignored thinking field if present');
    }

    const raw = data?.message?.content ?? '';

    if (!raw) {
      console.error('[LLM] empty content from Ollama');
      return null;
    }

    console.log('[LLM] raw (first 300):', JSON.stringify(raw.slice(0, 300)));

    let parsed: Record<string, unknown>;
    try {
      // Strip code fences Ollama occasionally adds even in JSON mode
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      console.warn('[LLM] JSON parse failed');
      return null;
    }

    console.log('[LLM] parsed JSON answer');

    const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';

    if (!answer) {
      console.warn('[LLM] parsed.answer missing or empty');
      return null;
    }

    if (hasReasoningLeak(answer)) {
      console.warn('[LLM] rejected reasoning leak');
      return null;
    }

    // If it's a refusal, return as-is (no source link)
    if (answer === REFUSAL) {
      console.log(`[LLM] refusal | ${durationMs}ms`);
      return REFUSAL;
    }

    // Append source URL if not already present in the answer
    let final = answer;
    if (sourceUrl && !answer.includes(sourceUrl)) {
      final = `${answer}\n\nFor more information, check: ${sourceUrl}`;
    }

    // Discord hard limit
    if (final.length > 1900) final = final.slice(0, 1897) + '…';

    console.log('[LLM] formatted (first 200):', JSON.stringify(final.slice(0, 200)));
    console.log(`[LLM] success | ${durationMs}ms | ${final.length} chars`);
    return final;
  } catch (err) {
    const durationMs = Date.now() - startMs;
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[LLM] timed out after ${TIMEOUT_MS / 1000}s (${durationMs}ms)`);
    } else {
      console.error(`[LLM] error (${durationMs}ms):`, err);
    }
    return null;
  }
}
