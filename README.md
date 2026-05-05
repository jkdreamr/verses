# Verses

A distraction-free lyric-writing tool for musicians. Think Freewrite, but built for songwriting — with rhyme suggestions, beat playback, and handwritten-paper scanning.

- **Editor:** full-screen, dark, serif-by-default. Auto-saves every 10 seconds.
- **Rhymes:** highlight any word → 🎵 chip → perfect / near / sounds-like results from [Datamuse](https://www.datamuse.com/api/), grouped by syllable count.
- **YouTube:** paste any URL, write to the beat. Loop, seek, ⌘P to play/pause.
- **OCR:** photo of handwritten lyrics → text, fully client-side via Tesseract.js.
- **Versions:** every save creates a snapshot you can preview and restore.
- **Export:** .txt, copy to clipboard, print view.
- **Auth:** Supabase email/password + Google OAuth. Guest mode keeps songs in `localStorage`.

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
  youtube_title  text
);

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

## Notes

- Datamuse calls are debounced 300ms and cached in memory per session.
- The Rhyme panel and OCR engine both lazy-load so the editor opens instantly.
- The YouTube player is rendered with width/height 0 — controls live in our own bottom bar so the editor never loses focus.

## Deploy

[Deploy to Vercel](https://vercel.com/new) → import this repo → set the two `NEXT_PUBLIC_SUPABASE_*` env vars → done.
