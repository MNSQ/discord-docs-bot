import { NextRequest } from 'next/server';
import { getDb } from '@/lib/supabase';
import { chunkText, cleanContent } from '@/lib/rag';

const MAX_PAGES = 100;
const PAGE_TIMEOUT_MS = 8_000;

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchPage(
  url: string,
): Promise<{ text: string; contentType: string } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'DocBot/1.0 (documentation importer)' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    return { text, contentType };
  } catch {
    return null;
  }
}

// ─── HTML → plain text ───────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Content cleaning ─────────────────────────────────────────────────────────
//
// Removes documentation-index boilerplate that some sites embed on every page.
// These are navigation aids, not answer content, and pollute retrieval results.

function cleanPageText(text: string): string {
  return text
    .replace(/Fetch the complete documentation index at:\s*\S+\s*/gi, '')
    .replace(/Use this file to discover all available pages before exploring further\.?\s*/gi, '')
    .replace(/^#{0,3}\s*Documentation\s+Index\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Title extraction ─────────────────────────────────────────────────────────

function deriveTitle(raw: string, contentType: string, url: string): string {
  if (contentType.includes('text/html')) {
    const t = raw.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    if (t) return t;
    const h = raw.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim();
    if (h) return h;
  } else {
    const h = raw.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim();
    if (h) return h;
  }
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return seg.replace(/[-_]/g, ' ') || url;
  } catch {
    return url;
  }
}

// ─── Link extraction ─────────────────────────────────────────────────────────

function extractMarkdownLinks(text: string): Array<{ title: string; url: string }> {
  const re = /\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)/g;
  const results: Array<{ title: string; url: string }> = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push({ title: m[1].trim(), url: m[2].trim() });
  }
  return results;
}

function shouldSkip(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return (
    /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|tar|gz)$/i.test(lower) ||
    /\.(json|yaml|yml)$/i.test(lower) ||
    lower.includes('openapi') ||
    lower.includes('swagger') ||
    lower.includes('/_next/') ||
    lower.includes('/api/') ||
    lower.endsWith('/llms.txt')   // index file itself — never import as content
  );
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const rawUrl: string = body?.url?.trim() ?? '';
  const mode: string = body?.mode ?? 'single_page';

  if (!rawUrl) {
    return Response.json({ error: 'url is required' }, { status: 400 });
  }

  let parsedInput: URL;
  try {
    parsedInput = new URL(rawUrl);
  } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const discordGuildId = process.env.DISCORD_GUILD_ID;
  if (!discordGuildId) {
    return Response.json({ error: 'DISCORD_GUILD_ID is not set' }, { status: 500 });
  }

  let db;
  try {
    db = getDb();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const { data: guild, error: guildErr } = await db
    .from('guilds')
    .upsert(
      { discord_guild_id: discordGuildId, name: 'Test Guild' },
      { onConflict: 'discord_guild_id' },
    )
    .select('id')
    .single();

  if (guildErr || !guild) {
    console.error('[import-url] guild upsert error:', guildErr);
    return Response.json({ error: 'Failed to upsert guild' }, { status: 500 });
  }

  // ── Collect pages ─────────────────────────────────────────────────────────

  let pages: Array<{ title: string; url: string }> = [];

  if (mode === 'site_index') {
    const llmsUrl = `${parsedInput.origin}/docs/llms.txt`;
    console.log('[import-url] fetching index:', llmsUrl);

    const index = await fetchPage(llmsUrl);
    if (!index) {
      return Response.json({ error: `Could not fetch ${llmsUrl}` }, { status: 502 });
    }

    const links = extractMarkdownLinks(index.text);
    console.log('[import-url] links in index:', links.length);

    const seen = new Set<string>();
    for (const link of links) {
      let abs: string;
      try {
        abs = new URL(link.url, parsedInput.origin).href;
      } catch {
        continue;
      }
      const u = new URL(abs);
      if (u.origin !== parsedInput.origin) continue;
      if (!u.pathname.startsWith('/docs/')) continue;
      if (shouldSkip(u.pathname)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      pages.push({ title: link.title, url: abs });
      if (pages.length >= MAX_PAGES) break;
    }

    console.log('[import-url] pages after filtering:', pages.length);
    if (pages.length === 0) {
      return Response.json(
        { error: 'No importable /docs/ pages found in the index file' },
        { status: 400 },
      );
    }
  } else {
    pages = [{ title: '', url: rawUrl }];
  }

  // ── Import each page ──────────────────────────────────────────────────────

  let imported = 0;
  let replaced = 0;
  let skipped = 0;
  let totalChunks = 0;

  for (const page of pages) {
    console.log('[import-url] fetching:', page.url);

    const fetched = await fetchPage(page.url);
    if (!fetched) {
      console.log('[import-url] skipped (fetch failed):', page.url);
      skipped++;
      continue;
    }

    const { text: raw, contentType } = fetched;
    const isHtml = contentType.includes('text/html');
    // htmlToText strips HTML structure; cleanContent handles MDX artifacts,
    // image syntax, and boilerplate phrases for both HTML and markdown pages.
    const afterHtml = isHtml ? htmlToText(raw) : raw;
    const cleaned   = cleanContent(afterHtml);

    if (cleaned.length < 80) {
      console.log('[import-url] skipped (too short after cleaning):', page.url);
      skipped++;
      continue;
    }

    const title = page.title || deriveTitle(raw, contentType, page.url);
    const chunks = chunkText(cleaned);

    if (chunks.length === 0) {
      console.log('[import-url] skipped (no chunks):', page.url);
      skipped++;
      continue;
    }

    // Replace existing document for this URL — avoids duplicate chunks on re-import.
    // Cascade delete removes chunks automatically via the FK constraint.
    const { data: existing } = await db
      .from('documents')
      .select('id')
      .eq('guild_id', guild.id)
      .eq('source_url', page.url)
      .maybeSingle();

    if (existing) {
      await db.from('documents').delete().eq('id', existing.id);
      replaced++;
      console.log('[import-url] replaced existing document for:', page.url);
    }

    const { data: doc, error: docErr } = await db
      .from('documents')
      .insert({ guild_id: guild.id, title, source_type: 'url', source_url: page.url })
      .select('id')
      .single();

    if (docErr || !doc) {
      console.error('[import-url] doc insert failed:', page.url, docErr?.message);
      skipped++;
      continue;
    }

    const rows = chunks.map((content, index) => ({
      document_id: doc.id,
      guild_id: guild.id,
      chunk_index: index,
      content,
    }));

    const { error: chunkErr } = await db.from('document_chunks').insert(rows);
    if (chunkErr) {
      console.error('[import-url] chunk insert failed:', page.url, chunkErr.message);
      await db.from('documents').delete().eq('id', doc.id);
      skipped++;
      continue;
    }

    console.log(`[import-url] imported: "${title}" — ${chunks.length} chunk(s)`);
    imported++;
    totalChunks += chunks.length;
  }

  console.log(
    `[import-url] done. imported=${imported} replaced=${replaced} skipped=${skipped} chunks=${totalChunks}`,
  );

  return Response.json({ ok: true, imported, replaced, skipped, chunks: totalChunks });
}
