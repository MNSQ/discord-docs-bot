import { NextRequest, NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import { retrieveRelevantChunks, cleanContent, type Chunk } from '@/lib/rag';
import { logUsage } from '@/lib/usage';
import { generateAnswer, REFUSAL } from '@/lib/llm';

// ─── Signature verification ───────────────────────────────────────────────────

async function verifySignature(
  request: NextRequest,
): Promise<{ valid: boolean; body: string }> {
  const signature = request.headers.get('x-signature-ed25519') ?? '';
  const timestamp  = request.headers.get('x-signature-timestamp') ?? '';
  const body       = await request.text();
  const publicKey  = process.env.DISCORD_PUBLIC_KEY ?? '';

  if (!publicKey || !signature || !timestamp) return { valid: false, body };

  const valid = nacl.sign.detached.verify(
    Buffer.from(timestamp + body),
    Buffer.from(signature, 'hex'),
    Buffer.from(publicKey, 'hex'),
  );

  return { valid, body };
}

// ─── Discord webhook ──────────────────────────────────────────────────────────

async function patchReply(token: string, content: string): Promise<void> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId || !token) {
    console.error('[discord] cannot patch: missing DISCORD_APPLICATION_ID or token');
    return;
  }

  const url = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`;

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      console.log('[discord] original response updated');
    } else {
      console.error('[discord] patch failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[discord] patch error:', err);
  }
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

function buildFallback(chunks: Chunk[]): string {
  const top = chunks[0];
  if (!top) return REFUSAL;

  let cleaned = cleanContent(top.content)
    .replace(/^#+\s*.*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleaned || cleaned.length < 30) return REFUSAL;

  const sentences = cleaned.match(/[^.!?\n]{20,}[.!?]+(?:\s|$)/g) ?? [];
  const excerpt = sentences
    .map(s => s.trim())
    .filter(s =>
      !s.toLowerCase().startsWith('see ') &&
      !s.toLowerCase().startsWith('note:') &&
      s.length > 30 && s.length < 400,
    )
    .slice(0, 2)
    .join(' ')
    .trim();

  if (!excerpt) return REFUSAL;

  const parts = [excerpt];
  if (top.source_url) {
    parts.push('');
    parts.push(`For more information, check: ${top.source_url}`);
  }
  const result = parts.join('\n');
  return result.length > 1900 ? result.slice(0, 1897) + '…' : result;
}

// ─── Background handler (all slow work lives here) ────────────────────────────
// Called with void — must never be awaited before returning the deferred response.

async function handleAskInteraction(interaction: Record<string, unknown>): Promise<void> {
  console.log('[discord] background started');

  const question      = (interaction.data as any)?.options?.find((o: any) => o.name === 'question')?.value ?? '';
  const discordGuildId = String((interaction as any).guild_id ?? '');
  const userId         = String((interaction as any).member?.user?.id ?? (interaction as any).user?.id ?? 'unknown');
  const token          = String((interaction as any).token ?? '');

  try {
    const chunks = await retrieveRelevantChunks(question, discordGuildId);

    if (chunks === null) {
      console.log('[/ask] retrieval → null (no docs for this guild)');
    } else if (chunks.length === 0) {
      console.log('[/ask] retrieval → [] (no match or off-topic)');
    } else {
      const top = chunks[0];
      console.log(
        '[/ask] retrieval →', chunks.length, 'chunk(s)',
        '| source:', top.source_url ?? 'none',
        '| preview:', top.content.slice(0, 80).replace(/\n/g, ' '),
      );
    }

    const answered = chunks !== null && chunks.length > 0;
    logUsage({ discordGuildId, userId, question, answered });

    let content: string;

    if (chunks === null) {
      content = 'I do not have any documentation for this server yet.';
    } else if (chunks.length === 0) {
      content = REFUSAL;
    } else {
      const answer = await generateAnswer(question, chunks);
      if (!answer) console.log('[/ask] LLM returned null — using fallback');
      content = answer ?? buildFallback(chunks);
    }

    await patchReply(token, content);
  } catch (err) {
    console.error('[discord] background failed:', err);
    await patchReply(token, REFUSAL).catch(() => {});
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Verify Discord signature
  const { valid, body } = await verifySignature(request);
  if (!valid) return new Response('Invalid request signature', { status: 401 });

  // 2. Parse interaction
  const interaction = JSON.parse(body) as Record<string, unknown>;

  // Discord PING — must respond synchronously
  if (interaction.type === 1) return NextResponse.json({ type: 1 });

  // Slash command
  if (interaction.type === 2) {
    const name = (interaction.data as any)?.name ?? '';

    if (name === 'ask') {
      const question = (interaction.data as any)?.options?.find(
        (o: any) => o.name === 'question',
      )?.value ?? '';

      console.log('[/ask] guild_id:', interaction.guild_id, '| question:', question);

      if (!question) {
        return NextResponse.json({ type: 4, data: { content: 'Please provide a question.' } });
      }

      // 3. Start all slow work in the background — do NOT await
      void handleAskInteraction(interaction);

      // 4. Return deferred response immediately — Discord 3-second window
      console.log('[discord] returning deferred response now');
      return NextResponse.json({ type: 5 });
    }
  }

  return new Response('Unknown interaction type', { status: 400 });
}
