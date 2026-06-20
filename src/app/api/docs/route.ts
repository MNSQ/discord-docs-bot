import { NextRequest } from 'next/server';
import { getDb } from '@/lib/supabase';
import { chunkText } from '@/lib/rag';

// GET /api/docs?guild_id=<discord_snowflake>
export async function GET(request: NextRequest) {
  const discordGuildId = request.nextUrl.searchParams.get('guild_id')?.trim() ?? '';
  if (!discordGuildId) {
    return Response.json({ error: 'guild_id is required' }, { status: 400 });
  }

  let db;
  try {
    db = getDb();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const { data: guild } = await db
    .from('guilds')
    .select('id')
    .eq('discord_guild_id', discordGuildId)
    .maybeSingle();

  if (!guild) return Response.json({ docs: [] });

  const { data, error } = await db
    .from('documents')
    .select('id, title, source_type, source_url, created_at')
    .eq('guild_id', guild.id)
    .order('created_at', { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ docs: data ?? [] });
}

// POST /api/docs  { guild_id, title, content }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const title: string          = body?.title?.trim()    ?? '';
  const content: string        = body?.content?.trim()  ?? '';
  const discordGuildId: string = body?.guild_id?.trim() ?? '';

  if (!title || !content) {
    return Response.json({ error: 'title and content are required' }, { status: 400 });
  }
  if (!discordGuildId) {
    return Response.json({ error: 'Discord Server ID is required' }, { status: 400 });
  }

  let db;
  try {
    db = getDb();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const { data: guild, error: guildErr } = await db
    .from('guilds')
    .upsert({ discord_guild_id: discordGuildId }, { onConflict: 'discord_guild_id' })
    .select('id')
    .single();

  if (guildErr || !guild) {
    console.error('Guild upsert error:', guildErr);
    return Response.json({ error: 'Failed to upsert guild' }, { status: 500 });
  }

  const { data: doc, error: docErr } = await db
    .from('documents')
    .insert({ guild_id: guild.id, title, source_type: 'paste' })
    .select('id')
    .single();

  if (docErr || !doc) {
    console.error('Document insert error:', docErr);
    return Response.json({ error: 'Failed to insert document' }, { status: 500 });
  }

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
