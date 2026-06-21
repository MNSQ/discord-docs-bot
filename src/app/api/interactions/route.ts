import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import nacl from 'tweetnacl';
import { retrieveRelevantChunks } from '@/lib/rag';
import { logUsage } from '@/lib/usage';
import { generateAnswer, REFUSAL } from '@/lib/llm';

const LLM_FAILURE_MSG =
  'I found relevant documentation, but I could not generate a proper answer right now. Please try again in a moment.';

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

// ─── Intent detection (for logging) ──────────────────────────────────────────

function detectIntent(question: string): string {
  const q = question.toLowerCase();
  const isTokenomics = /token|tokenomics|emission|staking|supply|coin|governance|vesting|airdrop/.test(q);
  const isBroad = /^(?:tell\s+me\s+about|what\s+(?:is|are)|explain|describe|give\s+me\s+an?\s+overview)\b/.test(q)
               || /ionet|io\.net|io\s+network/.test(q);
  if (isBroad && isTokenomics) return 'broad_tokenomics';
  if (isBroad) return 'broad_overview';
  return 'specific_feature';
}

// ─── Background handler (all slow work lives here) ────────────────────────────
// Called with void — must never be awaited before returning the deferred response.

async function handleAskInteraction(interaction: Record<string, unknown>): Promise<void> {
  console.log('[discord] background started');

  const question       = (interaction.data as any)?.options?.find((o: any) => o.name === 'question')?.value ?? '';
  const discordGuildId = String((interaction as any).guild_id ?? '');
  const userId         = String((interaction as any).member?.user?.id ?? (interaction as any).user?.id ?? 'unknown');
  const token          = String((interaction as any).token ?? '');

  const intent = detectIntent(question);
  console.log(`[/ask] question="${question}" intent=${intent}`);

  try {
    const result = await retrieveRelevantChunks(question, discordGuildId);
    console.log('[discord] retrieve complete');

    if (result === null) {
      console.log('[/ask] retrieval → null (no docs for this guild)');
    } else if (result.chunks.length === 0) {
      console.log('[/ask] retrieval → [] (no match or off-topic)');
    } else {
      const titles  = [...new Set(result.chunks.map(c => c.title).filter(Boolean))];
      console.log('[/ask] selected titles:', titles.join(' | ') || '(none)');
      console.log('[/ask] best source:', result.bestSource ?? '(none)');
      console.log(
        '[/ask] retrieval →', result.chunks.length, 'chunk(s)',
        '| preview:', result.chunks[0].content.slice(0, 80).replace(/\n/g, ' '),
      );
    }

    const answered = result !== null && result.chunks.length > 0;
    logUsage({ discordGuildId, userId, question, answered });

    let content: string;

    if (result === null) {
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
      const dashboardUrl = appUrl
        ? `${appUrl}/dashboard?guild_id=${encodeURIComponent(discordGuildId)}`
        : null;
      const lines = [
        'No documentation has been uploaded for this Discord server yet.',
        '',
        'Open the dashboard, paste this Discord Server ID, and upload your docs:',
        discordGuildId,
      ];
      if (dashboardUrl) lines.push('', `Dashboard: ${dashboardUrl}`);
      content = lines.join('\n');
    } else if (result.chunks.length === 0) {
      content = REFUSAL;
    } else {
      console.log('[discord] calling generateAnswer');
      try {
        content = await generateAnswer(question, result.chunks, result.bestSource);
        console.log('[discord] generateAnswer complete');
        console.log('[/ask] answer source: LLM');
      } catch (llmErr) {
        const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
        console.error('[/ask] LLM generation failed:', msg);
        console.error('[/ask] question:', JSON.stringify(question),
          '| chunks:', result.chunks.length,
          '| best source:', result.bestSource ?? '(none)');
        console.log('[/ask] answer source: LLM_FAILED — returning graceful error');
        content = LLM_FAILURE_MSG;
      }
    }

    console.log('[discord] calling patchReply');
    await patchReply(token, content);
    console.log('[discord] patchReply succeeded');
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

      // 3. Keep the Vercel function alive until the background task settles
      waitUntil(handleAskInteraction(interaction));

      // 4. Return deferred response immediately — Discord 3-second window
      console.log('[discord] returning deferred response now');
      return NextResponse.json({ type: 5 });
    }
  }

  return new Response('Unknown interaction type', { status: 400 });
}
