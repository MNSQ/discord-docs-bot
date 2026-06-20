import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';

export default function InstallPage() {
  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">

      <header className="flex items-center justify-between px-6 md:px-10 h-14 border-b border-zinc-200 dark:border-zinc-800">
        <Link href="/" className="font-semibold tracking-tight hover:opacity-80 transition-opacity">
          DocBot
        </Link>
        <ThemeToggle />
      </header>

      <main className="flex flex-col flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm flex flex-col gap-8">

          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Add DocBot to your server</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Click below to open Discord's permission screen. Select your server and authorize.
            </p>
          </div>

          <a
            href="/api/discord/install"
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-sm"
          >
            Add bot to Discord
          </a>

          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3">
              What happens next
            </p>
            <ol className="flex flex-col gap-3">
              {([
                'Discord asks you to choose a server and authorize.',
                'Copy the Server ID from your Discord server settings.',
                'Open the dashboard and paste the Server ID.',
                <>Upload your docs, then use{' '}<code className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-1 rounded">/ask</code>{' '}in Discord.</>,
              ] as React.ReactNode[]).map((step, i) => (
                <li key={i} className="flex gap-3 items-start text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-xs flex items-center justify-center font-medium tabular-nums">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <Link
            href="/dashboard"
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline underline-offset-4 transition-colors"
          >
            Go to Dashboard →
          </Link>

        </div>
      </main>

    </div>
  );
}
