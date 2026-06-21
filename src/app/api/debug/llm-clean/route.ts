import { NextRequest, NextResponse } from 'next/server';
import { cleanAnswer, sanitizeFinalAnswer } from '@/lib/llm';

// Dev-only endpoint for testing the answer post-processor.
// POST { "input": "raw model output" } → { "input", "cleaned", "sanitized", "error?" }
//
// Example inputs to test:
//   "Let me analyze the documentation...\n\nSection [1] is...\n\nThe IO tokenomics of io.net are..."
//   "</think>\n\nio.net is a decentralized compute network..."
//   "The most relevant section is [6]...\n\nYes, io.net offers VM on demand."

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return new Response('Not available in production', { status: 404 });
  }

  let body: { input?: unknown };
  try {
    body = (await req.json()) as { input?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.input !== 'string') {
    return NextResponse.json({ error: '"input" must be a string' }, { status: 400 });
  }

  const input = body.input;

  try {
    const cleaned   = cleanAnswer(input);
    const sanitized = sanitizeFinalAnswer(cleaned);
    return NextResponse.json({ input, cleaned, sanitized });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const cleaned = (() => { try { return cleanAnswer(input); } catch { return '(cleanAnswer threw)'; } })();
    return NextResponse.json({ input, cleaned, sanitized: null, error }, { status: 422 });
  }
}
