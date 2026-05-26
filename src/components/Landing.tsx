"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Landing page — editorial, cinematic. Dark by default.
 * Inspired by visual journal / art-tool aesthetics.
 */
export function Landing() {
  useEffect(() => {
    // Dark theme for the landing page
    const html = document.documentElement;
    const wasLight = html.classList.contains("light");
    html.classList.remove("light");
    return () => {
      if (wasLight) html.classList.add("light");
    };
  }, []);

  const featuresRef = useRef<HTMLElement>(null);

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      {/* ── Navigation ─────────────────────────────────────────────── */}
      <header className="fixed left-0 right-0 top-0 z-50 flex items-center justify-between px-8 py-6 sm:px-12">
        <span className="font-serif text-lg tracking-tight text-ink-text/90">
          Verses
        </span>
        <nav className="flex items-center gap-3 sm:gap-6">
          <button
            onClick={() =>
              featuresRef.current?.scrollIntoView({ behavior: "smooth" })
            }
            className="font-mono text-[9px] uppercase tracking-[0.3em] text-ink-mute/60 transition-colors duration-200 hover:text-ink-text"
          >
            About
          </button>
          <Link
            href="/app"
            className="font-mono text-[9px] uppercase tracking-[0.3em] text-amber-gold/80 transition-colors duration-200 hover:text-amber-gold"
          >
            Open app
          </Link>
        </nav>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="flex min-h-screen flex-col justify-center px-8 sm:px-12 lg:px-20">
        <div className="max-w-5xl">
          <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-amber-gold/70">
            A songwriting surface
          </p>
          <h1 className="mt-8 font-serif text-[clamp(3rem,8vw,7.5rem)] leading-[0.95] tracking-tight text-ink-text">
            Write the lyric.
            <br />
            <span className="text-ink-text/40">Play the chord.</span>
            <br />
            <span className="text-ink-text/20">Keep going.</span>
          </h1>
          <p className="mt-12 max-w-[52ch] text-[15px] leading-[1.8] text-ink-mute/70">
            Verses is a quiet writing surface for songwriters. Rhymes on demand.
            A beat loop that never steals focus. Your notebook page, scanned and
            typed. Nothing more.
          </p>
          <div className="mt-14 flex items-center gap-6">
            <Link
              href="/app"
              className="group relative overflow-hidden border border-amber-gold/40 px-6 py-3 font-mono text-[10px] uppercase tracking-[0.25em] text-amber-gold transition-all duration-300 hover:border-amber-gold/70 hover:shadow-[0_0_30px_rgba(201,168,76,0.08)] sm:px-8 sm:py-3.5"
            >
              <span className="relative z-10">Open in browser</span>
              <span className="absolute inset-0 -translate-x-full bg-amber-gold/5 transition-transform duration-300 group-hover:translate-x-0" />
            </Link>
            <a
              href="https://github.com/jkdreamr/verses"
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-mute/40 transition-colors duration-200 hover:text-ink-text/70"
            >
              GitHub
            </a>
          </div>
        </div>

        {/* Scroll hint — hidden on small screens, gentle pulse on desktop */}
        <div className="absolute bottom-12 left-1/2 hidden -translate-x-1/2 animate-pulse sm:block">
          <div className="h-8 w-px bg-gradient-to-b from-transparent to-ink-mute/20" />
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────── */}
      <section ref={featuresRef} className="px-8 pb-40 pt-20 sm:px-12 lg:px-20">
        <div className="mx-auto max-w-6xl">
          <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-amber-gold/60">
            Features
          </p>

          <div className="mt-20 grid gap-0 sm:grid-cols-2">
            <FeatureCard
              num="01"
              title="Rhymes on demand"
              body="Highlight any word. A small chip floats in. Click for perfect rhymes, near rhymes, and sound-alikes — grouped by syllables."
            />
            <FeatureCard
              num="02"
              title="Write to the beat"
              body="Paste a YouTube link. The bar sits at the bottom. Loop it. Keep writing. The music never steals your cursor."
            />
            <FeatureCard
              num="03"
              title="Page to screen"
              body="Snap a photo of your notebook. Verses runs OCR in-browser — nothing leaves your device — and drops the words into your draft."
            />
            <FeatureCard
              num="04"
              title="Quiet, by design"
              body="No streaks. No notifications. No AI suggestions. Saves every ten seconds. Version history. Export when ready."
            />
          </div>
        </div>
      </section>

      {/* ── Showcase: new features ────────────────────────────────── */}
      <section className="border-t border-ink-line/20 px-8 pb-40 pt-32 sm:px-12 lg:px-20">
        <div className="mx-auto max-w-6xl">
          <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-amber-gold/60">
            New in Verses
          </p>

          <div className="mt-20 grid gap-px sm:grid-cols-2">
            <ShowcaseCard
              num="05"
              title="Rhyme Lens"
              body="Inline highlights color-code every sound pattern across your lyrics. End rhymes, internal rhymes, slant, assonance, consonance — all at a glance. Toggle density modes to see exactly what you need."
            />
            <ShowcaseCard
              num="06"
              title="Perform Mode"
              body="Full-screen teleprompter with gesture-controlled drums. Hand tracking via your webcam synthesizes kick, snare, and hi-hat in real time. Your lyrics scroll. You play."
            />
          </div>
        </div>
      </section>

      {/* ── Download ───────────────────────────────────────────────── */}
      <section className="border-t border-ink-line/20 px-8 pb-32 pt-32 sm:px-12 lg:px-20">
        <div className="mx-auto max-w-6xl">
          <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-amber-gold/60">
            Get Verses
          </p>
          <h2 className="mt-8 font-serif text-4xl tracking-tight text-ink-text sm:text-5xl">
            On every surface
            <br />
            <span className="text-ink-text/30">you write on.</span>
          </h2>

          <div className="mt-16 flex flex-col">
            <DownloadRow
              label="Web"
              tag="Open instantly"
              href="/app"
              cta="Open"
              highlight
            />
            <DownloadRow
              label="Install as app"
              tag="PWA"
              href="/app"
              cta="Open"
              note="Click the install icon in your address bar"
            />
            <DownloadRow
              label="Desktop"
              tag="macOS / Windows / Linux"
              href="https://github.com/jkdreamr/verses/releases"
              cta="Releases"
              external
            />
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="border-t border-ink-line/10 px-8 py-10 sm:px-12 lg:px-20">
        <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-4">
          <span className="font-mono text-[8px] uppercase tracking-[0.3em] text-ink-mute/30">
            Built by{" "}
            <a
              href="https://github.com/jkdreamr/verses"
              target="_blank"
              rel="noreferrer"
              className="text-ink-mute/40 transition-colors duration-200 hover:text-ink-text/60"
            >
              @jkdreamr
            </a>
          </span>
          <Link
            href="/app"
            className="font-mono text-[8px] uppercase tracking-[0.3em] text-ink-mute/30 transition-colors duration-200 hover:text-amber-gold/60"
          >
            Open app
          </Link>
        </div>
      </footer>
    </main>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function FeatureCard({
  num,
  title,
  body,
}: {
  num: string;
  title: string;
  body: string;
}) {
  return (
    <div className="group border-b border-ink-line/10 px-8 py-12 transition-colors duration-300 hover:bg-ink-surface/30 sm:border-r sm:px-10 sm:py-14">
      <span className="font-mono text-[8px] uppercase tracking-[0.3em] text-ink-mute/30">
        {num}
      </span>
      <h3 className="mt-5 font-serif text-xl tracking-tight text-ink-text/90 transition-colors duration-300 group-hover:text-amber-gold">
        {title}
      </h3>
      <p className="mt-4 max-w-[38ch] text-[13px] leading-[1.75] text-ink-mute/50">
        {body}
      </p>
    </div>
  );
}

function ShowcaseCard({
  num,
  title,
  body,
}: {
  num: string;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-ink-surface/40 px-6 py-10 transition-colors duration-300 hover:bg-ink-surface/60 sm:px-10 sm:py-14">
      <span className="font-mono text-[8px] uppercase tracking-[0.3em] text-amber-gold/50">
        {num}
      </span>
      <h3 className="mt-6 font-serif text-3xl tracking-tight text-ink-text sm:text-4xl">
        {title}
      </h3>
      <p className="mt-6 max-w-[42ch] text-[13px] leading-[1.8] text-ink-mute/60">
        {body}
      </p>
    </div>
  );
}

function DownloadRow({
  label,
  tag,
  href,
  cta,
  note,
  highlight,
  external,
}: {
  label: string;
  tag: string;
  href: string;
  cta: string;
  note?: string;
  highlight?: boolean;
  external?: boolean;
}) {
  const Cmp = external ? "a" : Link;
  const extra = external ? { target: "_blank", rel: "noreferrer" } : {};
  return (
    <Cmp
      href={href}
      {...(extra as object)}
      className={`group flex items-baseline justify-between gap-6 border-b border-ink-line/10 py-5 transition-colors duration-200 ${
        highlight
          ? "text-amber-gold/80 hover:text-amber-gold"
          : "text-ink-text/70 hover:text-amber-gold/80"
      }`}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6">
        <span className="font-serif text-lg tracking-tight">{label}</span>
        <span className="font-mono text-[8px] uppercase tracking-[0.25em] text-ink-mute/40">
          {tag}
        </span>
        {note && (
          <span className="hidden text-[12px] text-ink-mute/30 sm:inline">
            {note}
          </span>
        )}
      </div>
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.2em] text-ink-mute/40 transition-colors duration-200 group-hover:text-amber-gold/60">
        {cta} &rarr;
      </span>
    </Cmp>
  );
}
