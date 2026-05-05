# Verses

A distraction-free lyric-writing tool for musicians. Think Freewrite, but built for songwriting — with rhyme suggestions, beat playback, and handwritten-paper scanning.

- **Editor:** full-screen, light/dark, serif-by-default. Auto-saves every 10 seconds.
- **Rhymes:** highlight any word → 🎵 chip → perfect / near / sounds-like results from [Datamuse](https://www.datamuse.com/api/), grouped by syllable count.
- **YouTube:** paste any URL, write to the beat. Loop, seek, ⌘P to play/pause.
- **OCR:** photo of handwritten lyrics → text, fully client-side via Tesseract.js.
- **Versions:** every save creates a snapshot you can preview and restore.
- **Export:** .txt, copy to clipboard, print view.
- **Auth:** Supabase email/password + Google OAuth. Guest mode keeps songs in `localStorage`.
- **Install anywhere:** PWA in the browser, native binaries via Tauri (`.dmg` / `.exe` / `.AppImage`).

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Marketing / landing page (light theme, links to download) |
| `/app` | Dashboard — list, search, tags, new song |
| `/editor/[id]` | The writing surface |
| `/login` | Email + Google sign-in |
| `/print/[id]` | Printable view |

## Tech

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase · Datamuse · YouTube IFrame API · Tesseract.js · deployed on Vercel.

## Local development

```bash
npm install
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

If you skip the env vars the app still runs in guest mode (songs save to `localStorage`).

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Copy **Project URL** and **anon public key** into `.env.local` (Vercel: Project Settings → Environment Variables).
3. In the SQL editor, run:

```sql
-- songs
create table if not exists public.songs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  title       text not null default '',
  content     text not null default '',
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists songs_user_id_idx on public.songs (user_id, updated_at desc);

-- snapshots created on auto-save
create table if not exists public.song_versions (
  id        uuid primary key default gen_random_uuid(),
  song_id   uuid not null references public.songs on delete cascade,
  content   text not null default '',
  saved_at  timestamptz not null default now()
);

create index if not exists song_versions_song_id_idx on public.song_versions (song_id, saved_at desc);

-- single YouTube session per song
create table if not exists public.youtube_sessions (
  id             uuid primary key default gen_random_uuid(),
  song_id        uuid not null unique references public.songs on delete cascade,
  youtube_url    text not null,
  youtube_title  text,
  markers        jsonb not null default '[]'::jsonb,
  loop_start     double precision,
  loop_end       double precision
);
-- if you upgraded from an earlier release, run:
--   alter table public.youtube_sessions
--     add column if not exists markers jsonb not null default '[]'::jsonb,
--     add column if not exists loop_start double precision,
--     add column if not exists loop_end double precision;

-- automatically set songs.user_id and updated_at
create or replace function public.set_song_owner()
returns trigger language plpgsql as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists set_song_owner on public.songs;
create trigger set_song_owner before insert or update on public.songs
  for each row execute function public.set_song_owner();

-- RLS
alter table public.songs            enable row level security;
alter table public.song_versions    enable row level security;
alter table public.youtube_sessions enable row level security;

create policy "songs: owner can read"
  on public.songs for select using (auth.uid() = user_id);
create policy "songs: owner can insert"
  on public.songs for insert with check (auth.uid() = user_id);
create policy "songs: owner can update"
  on public.songs for update using (auth.uid() = user_id);
create policy "songs: owner can delete"
  on public.songs for delete using (auth.uid() = user_id);

create policy "song_versions: owner can read"
  on public.song_versions for select using (
    exists (select 1 from public.songs s where s.id = song_id and s.user_id = auth.uid())
  );
create policy "song_versions: owner can insert"
  on public.song_versions for insert with check (
    exists (select 1 from public.songs s where s.id = song_id and s.user_id = auth.uid())
  );
create policy "song_versions: owner can delete"
  on public.song_versions for delete using (
    exists (select 1 from public.songs s where s.id = song_id and s.user_id = auth.uid())
  );

create policy "youtube_sessions: owner can read"
  on public.youtube_sessions for select using (
    exists (select 1 from public.songs s where s.id = song_id and s.user_id = auth.uid())
  );
create policy "youtube_sessions: owner can insert"
  on public.youtube_sessions for insert with check (
    exists (select 1 from public.songs s where s.id = song_id and s.user_id = auth.uid())
  );
create policy "youtube_sessions: owner can update"
  on public.youtube_sessions for update using (
    exists (select 1 from public.songs s where s.id = song_id and s.user_id = auth.uid())
  );
create policy "youtube_sessions: owner can delete"
  on public.youtube_sessions for delete using (
    exists (select 1 from public.songs s where s.id = song_id and s.user_id = auth.uid())
  );
```

## Google OAuth

In Supabase: **Authentication → Providers → Google**:

1. Enable the Google provider.
2. Click "Use Supabase OAuth" *or* paste your own Google credentials.
3. Copy the redirect URI Supabase shows you, e.g. `https://<project-ref>.supabase.co/auth/v1/callback`.
4. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), create an OAuth 2.0 Client (web). Add the redirect URI above. Add your authorised origins:
   - `http://localhost:3000`
   - `https://<your-vercel-domain>`
5. Paste the client ID + secret back into Supabase.
6. In Supabase **Authentication → URL Configuration**, set **Site URL** to your production domain and add additional redirect URLs:
   - `http://localhost:3000/auth/callback`
   - `https://<your-vercel-domain>/auth/callback`

That's it — the “Continue with Google” button on the login page will now work.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘ S` | Force save |
| `⌘ R` | Toggle Rhyme Finder (or look up the highlighted word) |
| `⌘ P` | Play / pause YouTube |
| `⌘ /` | Insert structure tag picker |
| `⌘ ⇧ H` | Open version history |
| `Esc` | Close any open panel |

## Themes

Verses ships dark by default. Toggle with the sun/moon button in the editor header or on the dashboard. Preference persists in `localStorage` (`verses:theme`). The marketing site at `/` is always light.

## Install as a PWA

The app declares a manifest (`/manifest.webmanifest`) and registers a service worker (`/sw.js`) so Chrome / Edge / Safari surface an "Install" affordance. Click ⊕ in the address bar (Chrome / Edge) or the Share menu → Add to Home Screen (Safari) to install Verses as its own app with a dock icon.

The service worker uses a network-first strategy for HTML and stale-while-revalidate for static assets, so once you've opened the editor you can keep writing offline. Datamuse, YouTube, and Supabase calls pass through the worker untouched and need a connection.

## Native desktop apps (Tauri)

Verses ships a Tauri scaffold for tiny native binaries on macOS, Windows, and Linux.

**Prerequisites:** Rust toolchain (`rustup install stable`) and platform deps:

- **macOS:** `xcode-select --install`
- **Windows:** [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) and [Visual Studio C++ build tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
- **Linux (Debian/Ubuntu):** `sudo apt install -y libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libxdo-dev libssl-dev pkg-config`

**Run in dev (loads `localhost:3000` in a native window):**

```bash
npm run tauri:dev
```

**Build production binaries:**

The Tauri shell loads `${VERSES_REMOTE_URL}/app` in a native window. Set this to your deployed URL before building so the binaries point at production:

```bash
VERSES_REMOTE_URL=https://your-domain.com npm run tauri:build
```

The binaries are written to `src-tauri/target/release/bundle/` (`.dmg` / `.app` on macOS, `.msi` on Windows, `.AppImage` / `.deb` on Linux).

> Why a remote URL? Verses uses dynamic routes (`/editor/[id]`) and a server route handler (`/auth/callback`) that aren't compatible with `next export`. Pointing the binary at the deployed Vercel app means rhymes, OCR, and auth all work without a backend running on the user's machine. A future change can convert the routes for full offline static export.

## Notes

- Datamuse calls are debounced 300ms and cached in memory per session.
- The Rhyme panel and OCR engine both lazy-load so the editor opens instantly.
- The YouTube player is rendered offscreen at 320×180 (with `pointer-events:none`) so it stays "layouted" enough for the IFrame API to play, while the editor never loses focus.

## Deploy

[Deploy to Vercel](https://vercel.com/new) → import this repo → set the two `NEXT_PUBLIC_SUPABASE_*` env vars → done. Then update `VERSES_REMOTE_URL` and rebuild Tauri to bake the new URL into the desktop binaries.
