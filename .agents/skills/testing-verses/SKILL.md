---
name: testing-verses
description: Test the Verses lyric-writing app end-to-end against the local dev server. Use when verifying any editor / dashboard / takes / YouTube / OCR / rhyme-finder change. Covers no-mic VM workarounds for media-recording features and the known YouTube playback constraint.
---

# Testing Verses locally

Verses is a Next.js 14 (App Router) + TS + Tailwind + Supabase app. All testing should happen against the **local dev server in guest mode** unless the user explicitly asks for a Supabase-backed run.

## Quick start

```bash
cd /home/ubuntu/repos/verses
npm run dev   # http://localhost:3000
```

- Marketing landing: `http://localhost:3000/`
- Dashboard: `http://localhost:3000/app`
- Editor: `http://localhost:3000/editor/<song-uuid>?guest=1`

`?guest=1` is the magic param — without it the editor will try to call Supabase. In guest mode, songs persist to `localStorage` (key `verses:songs`) and takes persist to **IndexedDB** (database `verses-takes`, store `takes`).

## Useful seed fixtures (guest mode)

After `npm run dev` you usually find one or two pre-existing songs in localStorage from prior sessions. Helpful canonical fixtures we've used:

- `9c3639a8-7f8e-4ac5-b69d-f33e5c2ed241` — "Round Two Test" with a YouTube session loaded (`Me at the zoo`)
- `0132f6f9-70ac-4978-8bfb-492d688a19c2` — "Open Mic Night" with longer lyrics (good for OCR / rhyme tests)

If they're missing, create them via `+ New Song` on the dashboard. Don't hardcode IDs — discover them from the dashboard URL or `localStorage.getItem('verses:songs')`.

## Hot-reload caveat (important)

`Toolbar.tsx`, `Editor.tsx`, and other top-level layout files sometimes need a **hard reload (Ctrl+Shift+R)** to pick up new buttons / wiring after a fresh feature is committed. If the rendered HTML doesn't show a button you know is in source, force-refresh before assuming the code is broken. Verify by inspecting the rendered HTML (`page_html_*.html` from the computer tool) against the source file's button list.

## Devin Secrets needed

None for guest-mode testing. For full (Supabase) mode:
- `NEXT_PUBLIC_SUPABASE_URL` (in `.env.local`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (in `.env.local`)

## Known VM constraints (must work around or disclose)

### 1. No microphone / camera hardware

The Devin VM has no physical mic or camera, and Chrome is launched **without** `--use-fake-device-for-media-stream`. So `navigator.mediaDevices.getUserMedia(...)` rejects with `NotFoundError: Requested device not found`.

**Implication:** the actual `getUserMedia → MediaRecorder.start → save` path of the takes feature **cannot be exercised end-to-end on the VM**. The user must verify real recording locally. Don't claim the recording happy path is passing — it isn't testable here.

**Workaround for storage / playback / rename / download / delete:** inject a real `MediaRecorder`-built audio blob directly into IndexedDB to bypass the mic requirement while still exercising the production read/write/delete paths. Pattern (paste into the page console):

```js
(async () => {
  const ac  = new AudioContext();
  const dst = ac.createMediaStreamDestination();
  const osc = ac.createOscillator();
  osc.frequency.value = 440; osc.connect(dst); osc.start();
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus' : 'audio/webm';
  const rec = new MediaRecorder(dst.stream, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => rec.onstop = r);
  rec.start(250);
  await new Promise(r => setTimeout(r, 1500));
  rec.stop(); await stopped; osc.stop(); ac.close();
  const blob = new Blob(chunks, { type: mime });
  const id = crypto.randomUUID();
  const SONG = '<song-uuid>';
  const db = await new Promise((res, rej) => { const r = indexedDB.open('verses-takes', 1); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  await new Promise((res, rej) => { const t = db.transaction('takes','readwrite'); t.objectStore('takes').put({ id, song_id: SONG, label: 'Synthetic 440Hz', mime, duration: 1.5, size: blob.size, has_video:false, blob, created_at: new Date().toISOString() }); t.oncomplete=res; t.onerror=()=>rej(t.error); });
  console.log('inserted', { id, size: blob.size });
})();
```

Then close + reopen the Takes panel (clicking the toolbar `takes` button toggles it) so the panel re-fetches from IndexedDB. The `reloadKey` prop in `Editor.tsx` is incremented after a real save — for an externally-injected take you have to rely on the panel's open-effect re-fetch.

### 2. YouTube IFrame bot challenge

YouTube serves `https://www.youtube.com/embed/<id>` with a Cloudflare bot challenge on the Devin VM IP. The iframe loads but `playVideo()` calls silently fail to actually start playback. Symptoms: toolbar `▶` button never flips state; `Cmd+P` doesn't toggle; `verses:beat-play` event listeners fire but the embedded player ignores `playVideo()`.

**Implication:** any test that depends on observing the YouTube iframe's playback state cannot be visually verified on the VM. Verify the wiring instead (e.g. dispatch a `verses:beat-play` event with a sentinel listener to confirm event-bus plumbing) and explicitly mark the playback assertion as `untested` in test reports — do NOT mark it passed.

### 3. Cross-origin postMessage to youtube.com iframe

You cannot intercept `iframe.contentWindow.postMessage` from page JS — CDP throws `evaluation failed`. Don't waste time trying to spy on the YouTube IFrame API messages; verify the wiring via the React-side listener registration instead.

## Standard end-to-end test checklist

For any feature change in the editor:

1. **Dashboard renders** with all expected fixtures + `+ New Song` works.
2. **Editor opens immediately** with cursor focused (no spinner).
3. **Title save** persists on blur and on SPA back-nav within 10s.
4. **Search** filters by title + lyrics body + tags.
5. **Theme toggle** persists across reload (`localStorage.verses:theme`).
6. **Takes / markers / loop / tunebat / OCR / rhymes / version-history** as applicable — see notes above for VM constraints.
7. **Cascade-on-song-delete** if the feature persists per-song data — verify the IndexedDB / localStorage probe goes from N → 0 after the dashboard delete double-confirm.

## Reporting conventions

- Post a single PR comment with `<details>/<summary>` collapsing screenshots.
- Lead with **escalations** (untested / failed / VM-constrained) before passes.
- Always include the recording attachment URL + Devin session URL.
- For media features, explicitly call out what the user has to verify locally because the VM can't.
- Use 'It should ...' style assertions matching `recording_start` annotations.
