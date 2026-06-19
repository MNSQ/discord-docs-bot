import { getDb } from '@/lib/supabase';

export interface Chunk {
  id: string;
  content: string;
  chunk_index?: number;
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

// ─── Keyword extraction ───────────────────────────────────────────────────────

// Generic English stopwords plus project-specific terms that appear in almost
// every chunk of the test manual, making them useless for discrimination.
const STOPWORDS = new Set([
  // Common English
  'what', 'is', 'the', 'a', 'an', 'how', 'does', 'do', 'to', 'in', 'of',
  'for', 'and', 'or', 'with', 'should', 'it', 'this', 'that', 'are', 'was',
  'be', 'by', 'from', 'at', 'on', 'as', 'not', 'but', 'if', 'when', 'which',
  'will', 'can', 'its', 'i', 'me', 'my', 'you', 'your', 'we', 'our',
  'they', 'them', 'their', 'has', 'have', 'had', 'been', 'being', 'would',
  'could', 'did', 'get', 'got', 'use', 'used', 'using', 'also', 'just',
  'then', 'than', 'too', 'very', 'so', 'up', 'out', 'only', 'same', 'any',
  // Project-generic — appear in nearly every chunk so carry no signal
  'docubot', 'alpha', 'discord', 'documentation', 'document', 'documents',
  'docs', 'bot', 'server', 'servers', 'question', 'questions', 'user',
  'users', 'ask', 'upload', 'uploaded', 'uploads',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// ─── IDF weighting ───────────────────────────────────────────────────────────

// Returns log(N/df) per keyword, or 0 when the term is too common (>50% of
// chunks contain it). Terms that appear in only 1–3 chunks score highest.
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
): number {
  const lower = content.toLowerCase();
  let score = 0;

  // Weighted term frequency
  for (const kw of keywords) {
    const w = idf.get(kw) ?? 0;
    if (w === 0) continue;
    score += w * countOccurrences(lower, kw);
  }

  // Full cleaned-phrase match — strong signal when the whole intent is present
  if (cleanPhrase.length > 6 && lower.includes(cleanPhrase)) {
    score += 5;
  }

  // Adjacent keyword bi-gram matches — more specific than individual terms
  for (let i = 0; i < keywords.length - 1; i++) {
    const bigram = `${keywords[i]} ${keywords[i + 1]}`;
    if (lower.includes(bigram)) score += 2;
  }

  return score;
}

// ─── Rank + select ────────────────────────────────────────────────────────────

interface RankResult {
  chunks: Chunk[];
  bestScore: number;
  bestIndex: number | undefined;
}

function rankAndSelect(candidates: Chunk[], question: string): RankResult {
  if (candidates.length === 0) {
    return { chunks: [], bestScore: 0, bestIndex: undefined };
  }

  const keywords = extractKeywords(question);
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
    score: scoreChunk(keywords, idf, cleanPhrase, c.content),
  }));
  scored.sort((a, b) => b.score - a.score);

  console.log('[RAG] top 5:');
  scored.slice(0, 5).forEach((s, rank) => {
    const preview = s.chunk.content.slice(0, 80).replace(/\n/g, ' ');
    console.log(`  #${rank + 1} idx=${s.chunk.chunk_index} score=${s.score.toFixed(2)} | ${preview}`);
  });

  const best = scored[0];
  const selected: Chunk[] = [best.chunk];

  // Append the next sequential chunk when the best ends with ':' or ','
  // — these almost always mean the content continues in the next chunk.
  const lastChar = best.chunk.content.trimEnd().slice(-1);
  if (lastChar === ':' || lastChar === ',') {
    const nextIdx = (best.chunk.chunk_index ?? -1) + 1;
    const next = candidates.find(c => c.chunk_index === nextIdx);
    if (next) selected.push(next);
  }

  console.log('[RAG] selected idx:', best.chunk.chunk_index, '| score:', best.score.toFixed(2));

  return { chunks: selected, bestScore: best.score, bestIndex: best.chunk.chunk_index };
}

// ─── Retrieval ────────────────────────────────────────────────────────────────
//
// Return semantics — callers must handle all three:
//   null  → no guild row or no chunks (server has no docs yet)
//   []    → chunks exist but bestScore is 0 (question has no keyword overlap)
//   [...] → best-matching chunk(s)

export async function retrieveRelevantChunks(
  question: string,
  discordGuildId: string,
): Promise<Chunk[] | null> {
  console.log('[RAG] guild:', discordGuildId, '| question:', question);

  if (!question.trim() || !discordGuildId) return null;

  let db;
  try {
    db = getDb();
  } catch (err) {
    console.error('[RAG] getDb() threw:', err);
    return null;
  }

  // Resolve Discord snowflake → internal guild UUID
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
    console.log('[RAG] no guild row for discord_guild_id:', discordGuildId);
    return null;
  }

  // Fetch all chunks for this guild. 100 is enough for MVP; IDF needs the
  // full set to calculate meaningful document-frequency weights.
  const { data: rows, error: chunksErr } = await db
    .from('document_chunks')
    .select('id, content, chunk_index')
    .eq('guild_id', guild.id)
    .order('chunk_index')
    .limit(100);

  if (chunksErr) {
    console.error('[RAG] chunks query error:', JSON.stringify(chunksErr));
    return null;
  }

  const candidates = (rows ?? []) as Chunk[];
  console.log('[RAG] candidates fetched:', candidates.length);

  if (candidates.length === 0) return null;

  const { chunks, bestScore } = rankAndSelect(candidates, question);

  if (bestScore === 0) {
    console.log('[RAG] no keyword overlap — no match');
    return [];
  }

  return chunks;
}
