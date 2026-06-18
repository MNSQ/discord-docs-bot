import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Returns null when credentials are not yet configured (local dev without Supabase).
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
