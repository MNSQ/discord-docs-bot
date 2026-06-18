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
            Click the button below to install DocBot. You&apos;ll be taken to Discord&apos;s
            OAuth page to grant the required permissions.
          </p>
        </div>

        <button
          disabled
          className="px-6 py-3 rounded-lg bg-indigo-600 text-white font-medium opacity-50 cursor-not-allowed"
          title="Discord OAuth not configured yet"
        >
          Add to Discord (coming soon)
        </button>

        <p className="text-xs text-zinc-400 dark:text-zinc-600 max-w-xs">
          Discord OAuth will be wired up in the next milestone once the bot
          application is registered.
        </p>
      </main>
    </div>
  );
}
