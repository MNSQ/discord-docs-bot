import { getDb } from '@/lib/supabase';

export interface Chunk {
  id: string;
  content: string;
  chunk_index?: number;
  source_url?: string | null;
  document_id?: string;
  title?: string | null;
}

// ─── Chunking ────────────────────────────────────────────────────────────────

export function chunkText(text: string, targetSize = 1000): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const para of paragraphs) {
    if (para.length > targetSize * 1.5) {
      flush();
      const sentences = para.match(/[^.!?\n]+[.!?\n]*/g) ?? [para];
      for (const sentence of sentences) {
        const s = sentence.trim();
        if (!s) continue;
        if (current && current.length + 1 + s.length > targetSize) flush();
        current = current ? `${current} ${s}` : s;
      }
    } else if (current && current.length + 2 + para.length > targetSize) {
      flush();
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }

  flush();
  return chunks;
}

// ─── Content cleaning ─────────────────────────────────────────────────────────
//
// Shared cleaner used at three points: import pipeline, retrieval candidates,
// and fallback output. Removes MDX components, image syntax, HTML tags, and
// boilerplate phrases so chunks contain only readable text.

export function cleanContent(text: string): string {
  let t = text;

  // MDX component blocks that are purely visual (Frame wraps images)
  t = t.replace(/<Frame[^>]*>[\s\S]*?<\/Frame>/gi, '');

  // HTML/MDX img tags (self-closing and paired)
  t = t.replace(/<img\b[^>]*\/?>/gi, '');

  // Markdown images: ![alt text](url)
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  // Bare CDN image URLs on their own lines (Mintlify, AWS S3, etc.)
  t = t.replace(/^https?:\/\/[^\s]*(?:mintlify|s3)[^\s]*/gim, '');

  // All remaining HTML/JSX tags — strips tags but keeps inner text
  // (so <Note>important thing</Note> → "important thing")
  t = t.replace(/<\/?[A-Za-z][A-Za-z0-9]*(?:\s[^>]*)?\s*\/?>/g, '');

  // HTML entities that may survive tag stripping
  t = t
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Markdown table separator rows (|---|---|) — remove entirely
  t = t.replace(/^\|[-:\s|]+\|$/gm, '');

  // Markdown table data rows — convert pipe-separated cells to readable text.
  // "| Total Coins | 1000 | Active |" → "Total Coins · 1000 · Active"
  t = t.replace(/^\|(.+)\|$/gm, (_match, inner: string) => {
    const cells = inner.split('|').map(c => c.trim()).filter(c => c.length > 0);
    return cells.join(' · ');
  });

  // Import metadata boilerplate — strip globally, not just at line start,
  // because the phrase can appear mid-line in some imported pages.
  t = t.replace(/Fetch the complete documentation index at:\s*\S+/gi, '');
  t = t.replace(/Use this file to discover all available pages before exploring further\.?/gi, '');
  t = t.replace(/Documentation\s+Index/gi, '');

  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Keyword extraction ───────────────────────────────────────────────────────

const STOPWORDS = new Set([
  // Common English grammar words
  'what', 'is', 'the', 'a', 'an', 'how', 'does', 'do', 'to', 'in', 'of',
  'for', 'and', 'or', 'with', 'should', 'it', 'this', 'that', 'are', 'was',
  'be', 'by', 'from', 'at', 'on', 'as', 'not', 'but', 'if', 'when', 'which',
  'will', 'can', 'its', 'i', 'me', 'my', 'you', 'your', 'we', 'our',
  'they', 'them', 'their', 'has', 'have', 'had', 'been', 'being', 'would',
  'could', 'did', 'get', 'got', 'use', 'used', 'using', 'also', 'just',
  'then', 'than', 'too', 'very', 'so', 'up', 'out', 'only', 'same', 'any',
  // Generic time/query/off-topic words that cannot anchor retrieval on their own.
  // A question like "today's inference count" still works because "inference"
  // and "count" remain and carry the semantic weight.
  'today', 'todays', 'current', 'currently', 'now', 'latest', 'live',
  'real', 'realtime', 'time', 'weather', 'paris',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// ─── IDF weighting ───────────────────────────────────────────────────────────

function buildIdf(keywords: string[], candidates: Chunk[]): Map<string, number> {
  const N = candidates.length;
  const idf = new Map<string, number>();
  for (const kw of new Set(keywords)) {
    const df = candidates.filter(c => c.content.toLowerCase().includes(kw)).length;
    if (df === 0 || df > N * 0.5) {
      idf.set(kw, 0);
    } else {
      idf.set(kw, Math.log(N / df));
    }
  }
  return idf;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) { n++; pos += needle.length; }
  return n;
}

function scoreChunk(
  keywords: string[],
  idf: Map<string, number>,
  cleanPhrase: string,
  content: string,
  title: string | null | undefined,
  sourceUrl: string | null | undefined,
): number {
  const lower = content.toLowerCase();
  let score = 0;

  // Weighted term frequency in content
  for (const kw of keywords) {
    const w = idf.get(kw) ?? 0;
    if (w === 0) continue;
    score += w * countOccurrences(lower, kw);
  }

  // Full phrase match — strong discriminative signal
  if (cleanPhrase.length > 6 && lower.includes(cleanPhrase)) {
    score += 5;
  }

  // Adjacent keyword bi-gram bonus
  for (let i = 0; i < keywords.length - 1; i++) {
    const bigram = `${keywords[i]} ${keywords[i + 1]}`;
    if (lower.includes(bigram)) score += 2;
  }

  // Title boost — differentiate exact word match from partial.
  // "Inception" page asked about "inception" → exact word match → very high boost.
  // Some other page with "inception" in a subtitle → smaller boost.
  if (title) {
    const titleLower = title.toLowerCase();
    const titleWords = titleLower.split(/[\s\-_\/.,!?]+/).filter(Boolean);
    for (const kw of keywords) {
      if ((idf.get(kw) ?? 0) > 0) {
        if (titleWords.includes(kw)) {
          score += 8;    // keyword IS a title word (e.g. "Inception" title for "inception" query)
        } else if (titleLower.includes(kw)) {
          score += 2;    // keyword appears somewhere in title but not as a standalone word
        }
      }
    }
  }

  // URL boost — exact URL path-segment match is the strongest signal.
  // /docs/guides/inception → "inception" is a segment → this page IS about Inception.
  // A block-rewards page that mentions "since inception" gets zero URL boost.
  if (sourceUrl) {
    const urlLower = sourceUrl.toLowerCase();
    const urlSegments = urlLower.split(/[\/\-_\.?#&]+/).filter(Boolean);
    for (const kw of keywords) {
      if ((idf.get(kw) ?? 0) > 0) {
        if (urlSegments.includes(kw)) {
          score += 10;   // keyword is an exact URL path segment — strongest relevance signal
        } else if (urlLower.includes(kw)) {
          score += 2;    // keyword appears in URL but not as its own segment
        }
      }
    }
  }

  return score;
}

// ─── Query expansion ─────────────────────────────────────────────────────────
//
// Maps known project name aliases to expanded keyword sets so IDF scoring
// finds relevant chunks even when the doc uses a different name variant.

const PROJECT_ALIAS_PATTERNS: [RegExp, string][] = [
  [/ionet/i,                   'ionet io network decentralized gpu infrastructure'],
  [/io\.net/i,                 'ionet io network decentralized gpu infrastructure'],
  [/io\s+network/i,            'io network ionet decentralized gpu'],
  [/decentralized\s+compute/i, 'decentralized compute gpu cloud inference'],
  [/gpu\s+network/i,           'gpu network decentralized compute cloud'],
  [/cloud\s+gpu/i,             'cloud gpu compute infrastructure'],
  [/ai\s+infrastructure/i,     'ai infrastructure compute gpu network'],
];

function expandQuery(question: string): string {
  const extras: string[] = [];
  for (const [pattern, expansion] of PROJECT_ALIAS_PATTERNS) {
    if (pattern.test(question)) extras.push(expansion);
  }
  return extras.length > 0 ? `${question} ${extras.join(' ')}` : question;
}

// Detects broad overview questions ("tell me about X", questions that name the
// project itself) so retrieval can widen its net and diversify results.
function isBroadQuestion(question: string): boolean {
  const q = question.toLowerCase().trim();
  if (/^tell\s+me\s+about\b/.test(q)) return true;
  if (/^(?:give\s+me\s+an?\s+)?overview\s+of\b/.test(q)) return true;
  if (/^(?:summarize|summary\s+of)\b/.test(q)) return true;
  return PROJECT_ALIAS_PATTERNS.some(([p]) => p.test(q));
}

// Returns true when a document looks like an overview or intro page.
function isOverviewDoc(
  title: string | null | undefined,
  sourceUrl: string | null | undefined,
): boolean {
  const SIGNALS = ['about', 'introduction', 'intro', 'overview', 'getting-started', 'get-started', 'what-is', 'home'];
  const text = `${title ?? ''} ${sourceUrl ?? ''}`.toLowerCase();
  return SIGNALS.some(s => text.includes(s));
}

// Picks the final context chunk set with per-document diversity and sibling
// continuity so the LLM receives a richer, less repetitive context window.
//   broad=true  → up to 6 chunks, max 2 per document
//   broad=false → up to 4 chunks, max 3 per document
function selectContextChunks(
  scored: Array<{ chunk: Chunk; score: number }>,
  broadQuestion: boolean,
  allCandidates: Chunk[],
): Chunk[] {
  const maxChunks = broadQuestion ? 6 : 4;
  const maxPerDoc = broadQuestion ? 2 : 3;
  const selected: Chunk[] = [];
  const seenIds   = new Set<string>();

  for (const { chunk } of scored) {
    if (selected.length >= maxChunks) break;
    if (seenIds.has(chunk.id)) continue;

    if (chunk.document_id) {
      const fromThisDoc = selected.filter(c => c.document_id === chunk.document_id).length;
      if (fromThisDoc >= maxPerDoc) continue;
    }

    selected.push(chunk);
    seenIds.add(chunk.id);

    // Include the next sibling when the current chunk ends abruptly, so
    // chunk-boundary fragments don't reach the LLM in an incomplete state.
    if (selected.length < maxChunks) {
      const lastChar = chunk.content.trimEnd().slice(-1);
      if (lastChar === ':' || lastChar === ',') {
        const nextIdx = (chunk.chunk_index ?? -1) + 1;
        const sibling = allCandidates.find(
          c => c.document_id === chunk.document_id &&
               c.chunk_index === nextIdx &&
               !seenIds.has(c.id),
        );
        if (sibling) {
          selected.push(sibling);
          seenIds.add(sibling.id);
        }
      }
    }
  }

  return selected;
}

// ─── Rank + select ────────────────────────────────────────────────────────────

interface RankResult {
  chunks: Chunk[];
  bestScore: number;
}

function rankAndSelect(
  candidates: Chunk[],
  question: string,
  broadQuestion: boolean,
): RankResult {
  if (candidates.length === 0) {
    return { chunks: [], bestScore: 0 };
  }

  const expandedQ   = expandQuery(question);
  const keywords    = extractKeywords(expandedQ);
  const cleanPhrase = question
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const idf = buildIdf(keywords, candidates);

  const kwLog = keywords
    .map(kw => `${kw}(${(idf.get(kw) ?? 0).toFixed(2)})`)
    .join(', ');
  console.log('[RAG] keywords:', kwLog || '(none after filtering)');

  const scored = candidates.map(c => ({
    chunk: c,
    score: scoreChunk(keywords, idf, cleanPhrase, c.content, c.title, c.source_url)
           + (broadQuestion && isOverviewDoc(c.title, c.source_url) ? 4 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);

  console.log('[RAG] top 5:');
  scored.slice(0, 5).forEach((s, rank) => {
    const preview  = s.chunk.content.slice(0, 50).replace(/\n/g, ' ');
    const urlTail  = s.chunk.source_url
      ? '…/' + s.chunk.source_url.split('/').slice(-2).join('/')
      : 'no-url';
    console.log(
      `  #${rank + 1} score=${s.score.toFixed(2)}`,
      `| title="${s.chunk.title ?? 'n/a'}"`,
      `| ${urlTail}`,
      `| ${preview}`,
    );
  });

  const selected  = selectContextChunks(scored, broadQuestion, candidates);
  const bestScore = scored[0]?.score ?? 0;

  console.log(
    '[RAG] selected', selected.length, 'chunk(s)',
    '| best score:', bestScore.toFixed(2),
    '| docs:', [...new Set(selected.map(c => c.title ?? 'n/a'))].join(', '),
  );

  return { chunks: selected, bestScore };
}

// ─── Policy / refusal chunk detection ────────────────────────────────────────

const REFUSAL_SIGNALS = [
  'should not answer', 'should avoid', 'should not respond',
  'avoid answering', 'avoid pretending', 'pretend to know',
  'cannot answer', 'will not answer', 'does not answer',
  'unable to answer', 'not designed to answer', 'not its purpose',
  'unrelated questions', 'unrelated topics', 'off-topic',
  'outside the scope', 'out of scope', 'outside its knowledge',
  'should refuse', 'should not pretend',
];

const POLICY_QUESTION_SIGNALS = [
  'refuse', 'refusal', 'avoid', 'avoids',
  'limitation', 'limitations', 'limit',
  'scope', 'out of scope', 'off-topic',
  'policy', 'policies', 'restriction', 'restrictions',
  'inappropriate', 'unable', 'cannot', "can't",
  'not answer', 'not designed', 'capable', 'designed to',
  'what won', 'what can the bot', 'what does the bot',
];

function isPolicyChunk(content: string): boolean {
  const lower = content.toLowerCase();
  return REFUSAL_SIGNALS.some(signal => lower.includes(signal));
}

function isAskingAboutPolicy(question: string): boolean {
  const lower = question.toLowerCase();
  return POLICY_QUESTION_SIGNALS.some(signal => lower.includes(signal));
}

// ─── Topic detection ─────────────────────────────────────────────────────────
//
// Identifies "What is X?" / "Tell me about X" questions and extracts the main
// topic X so we can find the authoritative document before IDF scoring runs.
// This prevents accidental body-text phrase matches (e.g. "since inception" in
// a block-rewards chunk) from beating the actual Inception page.

function cleanTopic(raw: string): string {
  return raw
    .toLowerCase()
    // Strip trailing "on io.net", "in IO Intelligence", etc.
    .replace(/\s+(?:on|in|for|at)\s+(?:io\.?net|io\s*intelligence|the\s+\w+\s+(?:platform|service|app))\s*$/i, '')
    // Strip trailing "used for", "used by", etc.
    .replace(/\s+(?:used\s+(?:for|in|by|to)|meant\s+for|designed\s+for)\s*$/i, '')
    .replace(/[?.,!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectTopic(question: string): string | null {
  const q = question.trim();
  const checks: [RegExp, number][] = [
    // "What is X?" / "What are X?" / "What's X?"
    [/^(?:what\s+(?:is|are|was|were)|what'?s)\s+(.+?)[?.]?$/i, 1],
    // "Tell me about X"
    [/^tell\s+me\s+about\s+(.+?)[?.]?$/i, 1],
    // "Explain X" / "Describe X" / "Define X"
    [/^(?:explain|describe|define)\s+(.+?)[?.]?$/i, 1],
    // "How does X work?"
    [/^how\s+does?\s+(.+?)\s+work[?.]?$/i, 1],
    // "What does X mean?"
    [/^what\s+does?\s+(.+?)\s+(?:mean|do|refer)[?.]?$/i, 1],
  ];

  for (const [pattern, group] of checks) {
    const m = q.match(pattern);
    if (m) {
      const topic = cleanTopic(m[group]);
      // Only return topics that have at least one word longer than 2 chars
      if (topic && topic.split(/\s+/).some(w => w.length > 2)) {
        return topic;
      }
    }
  }
  return null;
}

// Returns true when a document's title or URL is the authoritative source for
// the given topic (all significant topic words appear as title words or URL segments).
function topicMatchesDocument(
  topic: string,
  title: string | null | undefined,
  sourceUrl: string | null | undefined,
): boolean {
  const topicWords = topic.split(/\s+/).filter(w => w.length > 2);
  if (topicWords.length === 0) return false;

  if (title) {
    const titleLower = title.toLowerCase();
    const titleWords = titleLower.split(/[\s\-_\/.,!?()\[\]]+/).filter(Boolean);
    if (topicWords.every(w => titleWords.includes(w))) return true;
    if (titleLower.includes(topic)) return true;
  }

  if (sourceUrl) {
    const urlLower = sourceUrl.toLowerCase();
    const urlSegments = urlLower.split(/[\/\-_?#&=.]+/).filter(Boolean);
    if (topicWords.every(w => urlSegments.includes(w))) return true;
    if (urlLower.includes(topicWords.join('-'))) return true;
    if (urlLower.includes(topicWords.join('_'))) return true;
  }

  return false;
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

export const MIN_SCORE = 1.0;
const MAX_CANDIDATE_CHUNKS = 1000;

export async function retrieveRelevantChunks(
  question: string,
  discordGuildId: string,
): Promise<Chunk[] | null> {
  console.log('[RAG] ── retrieve ──────────────────────────');
  console.log('[RAG] discordGuildId:', discordGuildId);
  console.log('[RAG] question:', question);

  if (!question.trim() || !discordGuildId) return null;

  let db;
  try {
    db = getDb();
  } catch (err) {
    console.error('[RAG] getDb() threw:', err);
    return null;
  }

  // ── 1. Resolve Discord snowflake → internal guild UUID ────────────────────
  const { data: guild, error: guildErr } = await db
    .from('guilds')
    .select('id')
    .eq('discord_guild_id', discordGuildId)
    .maybeSingle();

  if (guildErr) {
    console.error('[RAG] guild lookup error:', JSON.stringify(guildErr));
    return null;
  }
  if (!guild) {
    console.log('[RAG] → No guild row. Bot not set up for this server.');
    return null;
  }
  console.log('[RAG] guild UUID:', guild.id);

  // ── 2. Sanity counts ──────────────────────────────────────────────────────
  const [docResult, chunkResult] = await Promise.all([
    db.from('documents').select('id', { count: 'exact', head: true }).eq('guild_id', guild.id),
    db.from('document_chunks').select('id', { count: 'exact', head: true }).eq('guild_id', guild.id),
  ]);
  const totalDocs   = docResult.count   ?? 0;
  const totalChunks = chunkResult.count ?? 0;
  console.log('[RAG] sanity — documents:', totalDocs, '| total chunks:', totalChunks);

  if (totalChunks === 0) {
    console.log('[RAG] → No chunks found. Upload documentation first.');
    return null;
  }

  // ── 3. Fetch chunks — plain query, no FK join ─────────────────────────────
  // FK joins are implicit INNER JOINs in PostgREST and can silently shrink the
  // result set. We fetch cleanly here and resolve metadata separately below.
  const { data: rawRows, error: chunksErr } = await db
    .from('document_chunks')
    .select('id, content, chunk_index, document_id')
    .eq('guild_id', guild.id)
    .order('chunk_index')
    .limit(MAX_CANDIDATE_CHUNKS);

  if (chunksErr) {
    console.error('[RAG] chunks query error:', JSON.stringify(chunksErr));
    return null;
  }

  type RawRow = { id: string; content: string | null; chunk_index: number; document_id: string };
  const rows = (rawRows as RawRow[]) ?? [];
  console.log('[RAG] rows returned by query:', rows.length);

  if (rows.length === 0) {
    console.log('[RAG] → 0 rows returned despite', totalChunks, 'counted. Check guild UUID filter.');
    return null;
  }

  // ── 4. Pre-fetch document metadata for all unique document_ids ────────────
  // Doing this BEFORE scoring enables title and source_url boosts during ranking.
  const allDocIds = [...new Set(rows.map(r => r.document_id).filter(Boolean))];

  type DocMeta = { id: string; title: string | null; source_url: string | null };
  const docMetaMap = new Map<string, DocMeta>();

  if (allDocIds.length > 0) {
    const { data: docs } = await db
      .from('documents')
      .select('id, title, source_url')
      .in('id', allDocIds);

    for (const d of (docs ?? []) as DocMeta[]) {
      docMetaMap.set(d.id, d);
    }
  }
  console.log('[RAG] document metadata loaded:', docMetaMap.size, 'doc(s)');

  // ── 5. Build candidate set — clean content, attach metadata ───────────────
  // cleanContent strips MDX components, images, and boilerplate phrases.
  // Only chunks that are empty after cleaning are dropped.
  const candidates: Chunk[] = rows
    .map(row => {
      const meta    = docMetaMap.get(row.document_id);
      const cleaned = cleanContent(row.content ?? '');
      return {
        id:          row.id,
        content:     cleaned,
        chunk_index: row.chunk_index,
        document_id: row.document_id,
        source_url:  meta?.source_url ?? null,
        title:       meta?.title      ?? null,
      };
    })
    .filter(c => c.content.length > 10);   // drop only truly empty/trivial chunks

  const cleaned_away = rows.length - candidates.length;
  console.log(
    '[RAG] candidates after cleaning:', candidates.length,
    cleaned_away > 0 ? `(${cleaned_away} became empty after boilerplate removal)` : '',
  );

  if (candidates.length === 0) {
    console.log('[RAG] → All chunks empty after cleaning. Check import boilerplate situation.');
    return null;
  }

  // ── 6. Off-topic guard: bail if no domain keywords survive stopword filter ──
  // Words like "weather", "paris", "today", "now" are stopwords, so a question
  // with only generic terms extracts 0 keywords → no meaningful match possible.
  const questionKeywords = extractKeywords(expandQuery(question));
  if (questionKeywords.length === 0) {
    console.log('[RAG] rejected — no meaningful domain keywords (off-topic question)');
    return [];
  }
  console.log('[RAG] meaningful keywords:', questionKeywords.join(', '));

  const broadQuestion = isBroadQuestion(question);
  if (broadQuestion) console.log('[RAG] broad overview question detected');

  // ── 7. Topic-aware routing ────────────────────────────────────────────────
  // For "What is X?" style questions, try to find the exact document about X
  // by matching title/URL BEFORE running IDF scoring. This sidesteps false
  // positives like "since inception" in a block-rewards page beating the real
  // Inception guide — no matter what the IDF distribution looks like.
  const topic = detectTopic(question);
  if (topic) {
    console.log('[RAG] topic detected:', topic);
    const matchedDocIds = new Set<string>();

    for (const [docId, meta] of docMetaMap.entries()) {
      if (topicMatchesDocument(topic, meta.title, meta.source_url)) {
        console.log('[RAG] topic matched document:', meta.title, '|', meta.source_url ?? 'no-url');
        matchedDocIds.add(docId);
      }
    }

    if (matchedDocIds.size > 0) {
      const topicCandidates = candidates.filter(
        c => c.document_id != null && matchedDocIds.has(c.document_id),
      );
      if (topicCandidates.length > 0) {
        const { chunks: topicChunks } = rankAndSelect(topicCandidates, question, broadQuestion);
        // Restore natural reading order after scoring
        topicChunks.sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0));
        console.log('[RAG] topic routing → returning', topicChunks.length, 'chunk(s) from matched document');
        return topicChunks;
      }
    } else {
      console.log('[RAG] topic detected but no document title/URL matched — using IDF scoring');
    }
  }

  // ── 8. Normal IDF scoring ────────────────────────────────────────────────
  const { chunks, bestScore } = rankAndSelect(candidates, question, broadQuestion);

  if (bestScore < MIN_SCORE) {
    console.log(`[RAG] score ${bestScore.toFixed(2)} below threshold ${MIN_SCORE} — no match`);
    return [];
  }

  // ── 9. Policy / refusal chunk guard ──────────────────────────────────────
  const topChunk = chunks[0];
  if (topChunk && isPolicyChunk(topChunk.content)) {
    if (isAskingAboutPolicy(question)) {
      console.log('[RAG] top chunk is policy — question IS about policy → returning it');
    } else {
      console.log('[RAG] top chunk is policy/refusal — rejecting (off-topic question)');
      return [];
    }
  }

  console.log(
    '[RAG] ✓ selected', chunks.length, 'chunk(s)',
    '| score:', bestScore.toFixed(2),
    '| idx:', chunks[0].chunk_index,
    '| title:', chunks[0].title ?? 'n/a',
    '| source_url:', chunks[0].source_url ?? 'none',
    '\n[RAG] preview:', chunks[0].content.slice(0, 100).replace(/\n/g, ' '),
  );

  return chunks;
}
