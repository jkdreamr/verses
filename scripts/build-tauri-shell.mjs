// Builds a tiny static shell consumed by `tauri build`.
//
// We don't do a full Next.js `output: "export"` here because the app uses
// dynamic routes (`/editor/[id]`, `/print/[id]`) and a server route
// (`/auth/callback`) that aren't compatible with static export without a
// non-trivial refactor.
//
// Instead, the desktop binary is a thin window pointed at the deployed URL.
// Set VERSES_REMOTE_URL (defaults to http://localhost:3000) to control where
// the binary loads from. After you've deployed to Vercel, set it to your
// public URL and re-run `npm run tauri:build`.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const target = process.env.VERSES_REMOTE_URL || "http://localhost:3000";
const dist = path.resolve(process.cwd(), "tauri-dist");
await mkdir(dist, { recursive: true });

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Verses</title>
    <style>
      html, body { background:#0d0d0d; color:#e8e8e8; height:100%; margin:0;
        font-family: Inter, system-ui, sans-serif; }
      .wrap { display:flex; align-items:center; justify-content:center; height:100%; }
      .card { padding:32px; border:1px solid #262626; border-radius:6px; max-width:420px; text-align:center; }
      a { color:#c9a84c; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <p style="margin:0 0 12px;font-family:Georgia,serif;font-size:28px;color:#c9a84c">Verses</p>
        <p>Loading the app from <a href="${target}/app">${target}</a>…</p>
        <p style="font-size:12px;color:#6b6b6b;margin-top:24px">If this stays here, edit <code>scripts/build-tauri-shell.mjs</code> and rebuild.</p>
      </div>
    </div>
    <script>
      // Replace the current document with the deployed app.
      window.location.replace(${JSON.stringify(target + "/app")});
    </script>
  </body>
</html>
`;

await writeFile(path.join(dist, "index.html"), html, "utf8");
console.log(`Wrote tauri-dist/index.html → ${target}/app`);
