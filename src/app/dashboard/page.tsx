import Link from 'next/link';

export default function DashboardPage() {
  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      <header className="flex items-center justify-between px-8 py-5 border-b border-zinc-200 dark:border-zinc-800">
        <Link href="/" className="font-semibold text-lg tracking-tight hover:underline underline-offset-4">
          DocBot
        </Link>
        <span className="text-sm text-zinc-400">Dashboard</span>
      </header>

      <main className="flex flex-col flex-1 items-center justify-center px-6 text-center gap-6 py-24">
        <div className="flex flex-col gap-3 max-w-md">
          <h1 className="text-3xl font-bold tracking-tight">Documentation Manager</h1>
          <p className="text-zinc-500 dark:text-zinc-400">
            This is where you&apos;ll manage the documentation DocBot uses to answer
            questions in your Discord server.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 max-w-xl w-full text-left mt-4">
          <PlaceholderCard title="Upload Documentation" description="Paste or upload text to build your knowledge base." />
          <PlaceholderCard title="Manage Documents" description="View, edit, or delete uploaded documentation." />
          <PlaceholderCard title="View Usage" description="See how many questions were asked and answered." />
          <PlaceholderCard title="Server Settings" description="Configure bot behavior per Discord server." />
        </div>

        <p className="text-xs text-zinc-400 dark:text-zinc-600 max-w-xs">
          Authentication and full functionality will be added in the next milestone.
        </p>
      </main>
    </div>
  );
}

function PlaceholderCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-2 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 opacity-60">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      <span className="text-xs text-indigo-400 mt-1">Coming soon</span>
    </div>
  );
}
