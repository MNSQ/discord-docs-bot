import { NextRequest } from 'next/server';
import { getDb } from '@/lib/supabase';
import { chunkText } from '@/lib/rag';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const title: string = body?.title?.trim() ?? '';
  const content: string = body?.content?.trim() ?? '';

  if (!title || !content) {
    return Response.json({ error: 'title and content are required' }, { status: 400 });
  }

  const discordGuildId = process.env.DISCORD_GUILD_ID;
  if (!discordGuildId) {
    return Response.json({ error: 'DISCORD_GUILD_ID is not set on the server' }, { status: 500 });
  }

  let db;
  try {
    db = getDb();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  // Ensure the test guild row exists.
  const { data: guild, error: guildErr } = await db
    .from('guilds')
    .upsert({ discord_guild_id: discordGuildId, name: 'Test Guild' }, { onConflict: 'discord_guild_id' })
    .select('id')
    .single();

  if (guildErr || !guild) {
    console.error('Guild upsert error:', guildErr);
    return Response.json({ error: 'Failed to upsert guild' }, { status: 500 });
  }

  // Insert document metadata.
  const { data: doc, error: docErr } = await db
    .from('documents')
    .insert({ guild_id: guild.id, title, source_type: 'paste' })
    .select('id')
    .single();

  if (docErr || !doc) {
    console.error('Document insert error:', docErr);
    return Response.json({ error: 'Failed to insert document' }, { status: 500 });
  }

  // Chunk and insert.
  const chunks = chunkText(content);
  if (chunks.length === 0) {
    return Response.json({ error: 'Content produced no chunks' }, { status: 400 });
  }

  const rows = chunks.map((text, index) => ({
    document_id: doc.id,
    guild_id: guild.id,
    chunk_index: index,
    content: text,
  }));

  const { error: chunkErr } = await db.from('document_chunks').insert(rows);
  if (chunkErr) {
    console.error('Chunk insert error:', chunkErr);
    return Response.json({ error: 'Failed to insert chunks' }, { status: 500 });
  }

  return Response.json({ ok: true, chunks: chunks.length });
}
