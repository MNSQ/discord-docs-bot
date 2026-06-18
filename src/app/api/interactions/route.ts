import { NextRequest } from 'next/server';
import nacl from 'tweetnacl';

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

export async function POST(request: NextRequest) {
  const { valid, body } = await verifySignature(request);

  if (!valid) {
    return new Response('Invalid request signature', { status: 401 });
  }

  const interaction = JSON.parse(body);

  // Discord PING — must respond with PONG or Discord rejects the endpoint
  if (interaction.type === 1) {
    return Response.json({ type: 1 });
  }

  // Slash command
  if (interaction.type === 2) {
    const name: string = interaction.data?.name ?? '';

    if (name === 'ask') {
      return Response.json({
        type: 4,
        data: { content: 'DocsBot received your question. RAG answer coming soon.' },
      });
    }
  }

  return new Response('Unknown interaction type', { status: 400 });
}
