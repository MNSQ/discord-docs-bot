import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">

      <header className="sticky top-0 z-10 flex items-center justify-between px-6 md:px-10 h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm">
        <span className="font-semibold tracking-tight">DocBot</span>
        <nav className="flex items-center gap-1">
          <Link href="/install" className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-3 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            Install
          </Link>
          <Link href="/dashboard" className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 px-3 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            Dashboard
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      <main className="flex flex-col flex-1">

        {/* Hero */}
        <section className="flex flex-col items-center text-center px-6 pt-20 pb-16 gap-7">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 dark:text-zinc-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
            Discord bot for documentation
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight max-w-2xl text-zinc-900 dark:text-zinc-50">
            Answer Discord questions<br className="hidden sm:block" /> directly from your docs
          </h1>

          <p className="text-base sm:text-lg text-zinc-500 dark:text-zinc-400 max-w-xl leading-relaxed">
            Add DocBot to your server, upload your documentation, and let your community get instant,
            accurate answers with{' '}
            <code className="font-mono text-sm bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-700 dark:text-zinc-300">/ask</code>.
            Answers come from your docs — not from the internet.
          </p>

          <div className="flex flex-wrap justify-center gap-3 pt-1">
            <a
              href="/api/discord/install"
              className="px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-sm"
            >
              Add bot to Discord
            </a>
            <Link
              href="/dashboard"
              className="px-5 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
            >
              Open Dashboard →
            </Link>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-zinc-100 dark:border-zinc-800 px-6 py-16">
          <div className="max-w-3xl mx-auto flex flex-col gap-10">
            <div className="text-center flex flex-col gap-2">
              <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Set up in minutes — no backend required</p>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <Card n="01" title="Add the bot"
                body="Install DocBot to your Discord server with one click. It only needs permission to respond to slash commands." />
              <Card n="02" title="Upload your docs"
                body="In the dashboard, paste your Server ID and upload documentation by URL, file, or plain text." />
              <Card n="03" title="Your community asks"
                body="Users type /ask with their question. DocBot searches your docs and replies with a grounded answer." />
            </div>
          </div>
        </section>

      </main>

      <footer className="border-t border-zinc-100 dark:border-zinc-800 py-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
        DocBot &mdash; powered by Next.js &amp; Vercel
      </footer>

    </div>
  );
}

function Card({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-4 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <span className="text-xs font-mono font-semibold text-indigo-500 dark:text-indigo-400 tracking-wider">{n}</span>
      <div className="flex flex-col gap-1.5">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">{title}</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
