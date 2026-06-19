import Link from 'next/link';
import DocsForm, { type Doc } from './DocsForm';
import { getDb } from '@/lib/supabase';

async function fetchDocs(discordGuildId: string): Promise<Doc[]> {
  try {
    const db = getDb();

    const { data: guild } = await db
      .from('guilds')
      .select('id')
      .eq('discord_guild_id', discordGuildId)
      .maybeSingle();

    if (!guild) return [];

    const { data } = await db
      .from('documents')
      .select('id, title, source_type, created_at')
      .eq('guild_id', guild.id)
      .order('created_at', { ascending: false });

    return (data ?? []) as Doc[];
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const guildId = process.env.DISCORD_GUILD_ID ?? '';
  const docs = guildId ? await fetchDocs(guildId) : [];

  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      <header className="flex items-center justify-between px-8 py-5 border-b border-zinc-200 dark:border-zinc-800">
        <Link href="/" className="font-semibold text-lg tracking-tight hover:underline underline-offset-4">
          DocBot
        </Link>
        <span className="text-sm text-zinc-400">Dashboard</span>
      </header>

      <main className="flex flex-col flex-1 items-center px-6 py-12 gap-8">
        {!guildId && (
          <p className="text-sm text-red-500">
            DISCORD_GUILD_ID is not set. Add it to .env.local to use the dashboard.
          </p>
        )}
        <DocsForm docs={docs} />
      </main>
    </div>
  );
}
