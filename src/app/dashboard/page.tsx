import Link from 'next/link';
import DocsForm from './DocsForm';

export default function DashboardPage() {
  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      <header className="flex items-center justify-between px-8 py-5 border-b border-zinc-200 dark:border-zinc-800">
        <Link href="/" className="font-semibold text-lg tracking-tight hover:underline underline-offset-4">
          DocBot
        </Link>
        <span className="text-sm text-zinc-400">Dashboard</span>
      </header>

      <main className="flex flex-col flex-1 items-center px-6 py-12 gap-8">
        <DocsForm />
      </main>
    </div>
  );
}
