import Link from 'next/link';
import DocsForm from './DocsForm';
import ThemeToggle from '@/components/ThemeToggle';

export default function DashboardPage() {
  return (
    <div className="flex flex-col min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">

      <header className="sticky top-0 z-10 flex items-center justify-between px-6 md:px-10 h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm">
        <Link href="/" className="font-semibold tracking-tight hover:opacity-80 transition-opacity">
          DocBot
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-400 dark:text-zinc-500">Dashboard</span>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-col flex-1 items-center px-6 py-10 gap-8">
        <DocsForm />
      </main>

    </div>
  );
}
