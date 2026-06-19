import { NextRequest } from 'next/server';
import nacl from 'tweetnacl';
import { retrieveRelevantChunks } from '@/lib/rag';

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

      console.log('[/ask] guild_id:', discordGuildId);
      console.log('[/ask] question:', question);

      if (!question) {
        return reply('Please provide a question.');
      }

      const chunks = await retrieveRelevantChunks(question, discordGuildId);

      console.log('[/ask] result:', chunks === null ? 'null (no docs)' : `${chunks.length} chunk(s)`);

      // null → guild has no docs at all
      if (chunks === null) {
        return reply('I do not have any documentation for this server yet.');
      }

      // [] → docs exist but no keyword match
      if (chunks.length === 0) {
        return reply('I do not have enough information in the uploaded documentation to answer that.');
      }

      // Join best chunk(s); truncate to Discord's limit.
      const text = chunks.map(c => c.content).join('\n\n');
      const truncated = text.length > DISCORD_MAX_LENGTH
        ? text.slice(0, DISCORD_MAX_LENGTH) + '…'
        : text;

      return reply(`I found this relevant documentation section:\n\n${truncated}`);
    }
  }

  return new Response('Unknown interaction type', { status: 400 });
}
