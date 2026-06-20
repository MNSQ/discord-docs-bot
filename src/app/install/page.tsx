import Link from 'next/link';

export default function InstallPage() {
  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      <header className="flex items-center justify-between px-8 py-5 border-b border-zinc-200 dark:border-zinc-800">
        <Link href="/" className="font-semibold text-lg tracking-tight hover:underline underline-offset-4">
          DocBot
        </Link>
      </header>

      <main className="flex flex-col flex-1 items-center justify-center px-6 text-center gap-8 py-24">
        <div className="flex flex-col gap-3 max-w-md">
          <h1 className="text-3xl font-bold tracking-tight">Add DocBot to your server</h1>
          <p className="text-zinc-500 dark:text-zinc-400">
            Click below to open Discord&apos;s permission screen. Choose your server and authorize the bot.
          </p>
        </div>

        <a
          href="/api/discord/install"
          className="px-6 py-3 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
        >
          Add bot to Discord
        </a>

        <ol className="flex flex-col gap-3 max-w-sm text-left text-sm text-zinc-600 dark:text-zinc-400 list-none">
          {[
            'Add the bot to your Discord server.',
            'Copy your Discord Server ID.',
            'Paste it in the dashboard and upload your docs.',
            <>Use <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">/ask</code> in that Discord server.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-3 items-start">
              <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs flex items-center justify-center font-semibold">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <Link href="/dashboard" className="text-sm text-indigo-500 hover:underline underline-offset-4">
          Go to Dashboard →
        </Link>
      </main>
    </div>
  );
}
