import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Server-side only. Never import this file from a Client Component.
// Uses the service role key — it bypasses RLS and must stay on the server.

let _db: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (_db) return _db;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Add them to .env.local and to Vercel environment variables.',
    );
  }

  _db = createClient(url, key, { auth: { persistSession: false } });
  return _db;
}
