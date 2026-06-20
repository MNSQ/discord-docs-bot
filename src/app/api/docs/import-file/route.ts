import { NextRequest } from 'next/server';
import { getDb } from '@/lib/supabase';
import { chunkText } from '@/lib/rag';
import mammoth from 'mammoth';

const SUPPORTED = new Set(['txt', 'md', 'docx']);

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'Failed to parse upload' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }

  const ext = (file.name.split('.').pop() ?? '').toLowerCase();

  if (ext === 'pdf') {
    return Response.json(
      {
        error:
          'PDF support is not yet available. Convert to .txt, .md, or .docx first, then upload.',
      },
      { status: 400 },
    );
  }

  if (!SUPPORTED.has(ext)) {
    return Response.json(
      { error: `Unsupported file type: .${ext}. Supported: .txt, .md, .docx` },
      { status: 400 },
    );
  }

  // ── Extract text ──────────────────────────────────────────────────────────

  let text: string;
  try {
    if (ext === 'txt' || ext === 'md') {
      text = await file.text();
    } else {
      // .docx → mammoth
      const buf = Buffer.from(await file.arrayBuffer());
      const result = await mammoth.extractRawText({ buffer: buf });
      result.messages
        .filter(m => m.type === 'error')
        .forEach(m => console.error('[import-file] mammoth error:', m.message));
      text = result.value;
    }
  } catch (err) {
    console.error('[import-file] extraction error:', err);
    return Response.json({ error: 'Failed to extract text from file' }, { status: 500 });
  }

  if (text.trim().length < 20) {
    return Response.json({ error: 'File appears empty or too short to import' }, { status: 400 });
  }

  // ── Guild ─────────────────────────────────────────────────────────────────

  const discordGuildId = (formData.get('guild_id') as string | null)?.trim() ?? '';
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
    console.error('[import-file] guild upsert error:', guildErr);
    return Response.json({ error: 'Failed to upsert guild' }, { status: 500 });
  }

  // ── Store ─────────────────────────────────────────────────────────────────

  const title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  const chunks = chunkText(text);

  if (chunks.length === 0) {
    return Response.json({ error: 'No content could be extracted' }, { status: 400 });
  }

  const { data: doc, error: docErr } = await db
    .from('documents')
    .insert({ guild_id: guild.id, title, source_type: 'file' })
    .select('id')
    .single();

  if (docErr || !doc) {
    console.error('[import-file] doc insert error:', docErr);
    return Response.json({ error: 'Failed to create document record' }, { status: 500 });
  }

  const rows = chunks.map((content, index) => ({
    document_id: doc.id,
    guild_id: guild.id,
    chunk_index: index,
    content,
  }));

  const { error: chunkErr } = await db.from('document_chunks').insert(rows);
  if (chunkErr) {
    console.error('[import-file] chunk insert error:', chunkErr);
    await db.from('documents').delete().eq('id', doc.id);
    return Response.json({ error: 'Failed to store document chunks' }, { status: 500 });
  }

  console.log(`[import-file] imported: "${title}" (.${ext}) — ${chunks.length} chunk(s)`);
  return Response.json({ ok: true, chunks: chunks.length, title });
}
