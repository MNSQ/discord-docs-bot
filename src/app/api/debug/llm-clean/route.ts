import { NextRequest, NextResponse } from 'next/server';
import { processModelOutput } from '@/lib/llm';

// Dev-only endpoint for testing the answer processing pipeline.
// POST { "input": "raw model output" }
// → { input, strippedThink, markerFound, reasoningDetected, answer, error? }
//
// Test cases:
//   "Let me analyze the documentation...\n\nFINAL_ANSWER:\nio.net is a decentralized compute network..."
//   → markerFound: true, reasoningDetected: false, answer: "io.net is a decentralized..."
//
//   "We are given a question...\n\nFrom the provided documentation..."
//   → markerFound: false, reasoningDetected: true
//
//   "</think>\n\nio.net is a decentralized compute network..."
//   → strippedThink: true, markerFound: false, reasoningDetected: false
//
//   "The most relevant section is [6]...\n\nFINAL_ANSWER:\nYes, io.net offers VM on demand."
//   → markerFound: true, reasoningDetected: false, answer: "Yes, io.net offers VM on demand."

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

  try {
    const result = processModelOutput(body.input);
    return NextResponse.json({ input: body.input, ...result });
  } catch (err) {
    return NextResponse.json(
      { input: body.input, error: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
