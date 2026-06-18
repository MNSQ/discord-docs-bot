export interface Chunk {
  id: string;
  content: string;
  score?: number;
}

export function chunkText(
  text: string,
  chunkSize = 500,
  overlap = 50,
): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start += chunkSize - overlap;
  }

  return chunks.filter(Boolean);
}

// Placeholder: will use Postgres full-text search once DB is wired.
export async function retrieveRelevantChunks(
  _question: string,
  _guildId: string,
): Promise<Chunk[]> {
  return [];
}

// Placeholder: will call an LLM once retrieval is wired and token budget allows.
export async function generateAnswerFromChunks(
  _question: string,
  chunks: Chunk[],
): Promise<string> {
  if (chunks.length === 0) {
    return 'This answer could not be found in the current documentation.';
  }
  // Real implementation will send chunks to the LLM here.
  return 'Answer generation not yet implemented.';
}
