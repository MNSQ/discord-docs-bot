import { NextRequest } from 'next/server';
import nacl from 'tweetnacl';
import { retrieveRelevantChunks } from '@/lib/rag';
import { logUsage } from '@/lib/usage';

const DISCORD_MAX_LENGTH = 1900;

async function verifySignature(
  request: NextRequest,
): Promise<{ valid: boolean; body: string }> {
  const signature = request.headers.get('x-signature-ed25519') ?? '';
  const timestamp = request.headers.get('x-signature-timestamp') ?? '';
  const body = await request.text();
  const publicKey = process.env.DISCORD_PUBLIC_KEY ?? '';

  if (!publicKey || !signature || !timestamp) {
    return { valid: false, body };
  }

  const valid = nacl.sign.detached.verify(
    Buffer.from(timestamp + body),
    Buffer.from(signature, 'hex'),
    Buffer.from(publicKey, 'hex'),
  );

  return { valid, body };
}

function reply(content: string) {
  return Response.json({ type: 4, data: { content } });
}

export async function POST(request: NextRequest) {
  const { valid, body } = await verifySignature(request);

  if (!valid) {
    return new Response('Invalid request signature', { status: 401 });
  }

  const interaction = JSON.parse(body);

  if (interaction.type === 1) {
    return Response.json({ type: 1 });
  }

  if (interaction.type === 2) {
    const name: string = interaction.data?.name ?? '';

    if (name === 'ask') {
      const question: string =
        interaction.data?.options?.find((o: { name: string }) => o.name === 'question')?.value ?? '';

      const discordGuildId: string = interaction.guild_id ?? '';

      // Discord puts the user in member.user for guild interactions, user for DMs.
      const userId: string =
        interaction.member?.user?.id ?? interaction.user?.id ?? 'unknown';

      console.log('[/ask] guild_id:', discordGuildId, '| user:', userId);
      console.log('[/ask] question:', question);

      if (!question) {
        return reply('Please provide a question.');
      }

      const chunks = await retrieveRelevantChunks(question, discordGuildId);

      const answered = chunks !== null && chunks.length > 0;
      console.log('[/ask] answered:', answered, '| chunks:', chunks?.length ?? 'null');

      // Log this interaction without blocking the response.
      logUsage({ discordGuildId, userId, question, answered });

      if (chunks === null) {
        return reply('I do not have any documentation for this server yet.');
      }

      if (chunks.length === 0) {
        return reply('I could not find this in the available documentation.');
      }

      const text = chunks.map(c => c.content).join('\n\n');
      const truncated = text.length > DISCORD_MAX_LENGTH
        ? text.slice(0, DISCORD_MAX_LENGTH) + '…'
        : text;

      return reply(`I found this relevant documentation section:\n\n${truncated}`);
    }
  }

  return new Response('Unknown interaction type', { status: 400 });
}
