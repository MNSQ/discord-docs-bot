import { getDb } from '@/lib/supabase';

interface UsageEntry {
  discordGuildId: string;
  userId: string;
  question: string;
  answered: boolean;
}

// Fire-and-forget — never awaited so it never blocks the Discord response.
// Errors are caught and logged to the server console only.
export function logUsage(entry: UsageEntry): void {
  void (async () => {
    try {
      const db = getDb();

      const { data: guild } = await db
        .from('guilds')
        .select('id')
        .eq('discord_guild_id', entry.discordGuildId)
        .maybeSingle();

      if (!guild) return; // no guild row means no docs were ever uploaded

      const { error } = await db.from('usage_logs').insert({
        guild_id: guild.id,
        user_id: entry.userId,
        question: entry.question,
        answered: entry.answered,
        cache_hit: false,
      });

      if (error) console.error('[usage] insert error:', error.message);
      else console.log('[usage] logged | answered:', entry.answered, '| user:', entry.userId);
    } catch (err) {
      console.error('[usage] unexpected error:', err);
    }
  })();
}
