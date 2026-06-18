const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const optional = (name: string): string | undefined => process.env[name];

export const env = {
  discord: {
    get publicKey() { return required('DISCORD_PUBLIC_KEY'); },
    get applicationId() { return required('DISCORD_APPLICATION_ID'); },
    get botToken() { return optional('DISCORD_BOT_TOKEN'); },
  },
  supabase: {
    get url() { return optional('NEXT_PUBLIC_SUPABASE_URL'); },
    get anonKey() { return optional('NEXT_PUBLIC_SUPABASE_ANON_KEY'); },
  },
};
