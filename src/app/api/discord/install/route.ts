import { NextResponse } from 'next/server';

export async function GET() {
  const appId = process.env.DISCORD_APPLICATION_ID;
  if (!appId) {
    return new Response('DISCORD_APPLICATION_ID is not configured', { status: 500 });
  }

  const params = new URLSearchParams({
    client_id:   appId,
    scope:       'bot applications.commands',
    permissions: '0',
  });

  return NextResponse.redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`,
  );
}
