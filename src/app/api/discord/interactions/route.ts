import { NextRequest } from 'next/server';
import nacl from 'tweetnacl';
import { retrieveRelevantChunks, generateAnswerFromChunks } from '@/lib/rag';

// Discord interaction types
const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 } as const;
const InteractionResponseType = { PONG: 1, CHANNEL_MESSAGE_WITH_SOURCE: 4 } as const;

async function verifyRequest(request: NextRequest): Promise<{ valid: boolean; body: string }> {
  const signature = request.headers.get('x-signature-ed25519') ?? '';
  const timestamp = request.headers.get('x-signature-timestamp') ?? '';
  const body = await request.text();

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    console.error('DISCORD_PUBLIC_KEY is not set');
    return { valid: false, body };
  }

  const isValid = nacl.sign.detached.verify(
    Buffer.from(timestamp + body),
    Buffer.from(signature, 'hex'),
    Buffer.from(publicKey, 'hex'),
  );

  return { valid: isValid, body };
}

export async function POST(request: NextRequest) {
  const { valid, body } = await verifyRequest(request);

  if (!valid) {
    return new Response('Invalid request signature', { status: 401 });
  }

  const interaction = JSON.parse(body);

  if (interaction.type === InteractionType.PING) {
    return Response.json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const commandName = interaction.data?.name;
    const guildId = interaction.guild_id ?? '';

    if (commandName === 'ask') {
      const question = interaction.data?.options?.find(
        (o: { name: string }) => o.name === 'question',
      )?.value ?? '';

      const chunks = await retrieveRelevantChunks(question, guildId);
      const answer = await generateAnswerFromChunks(question, chunks);

      return Response.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: answer },
      });
    }
  }

  return new Response('Unknown interaction type', { status: 400 });
}
