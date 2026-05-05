export function extractYoutubeId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  // youtu.be/<id>
  const short = trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (short) return short[1];
  // youtube.com/watch?v=<id>
  const watch = trimmed.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (watch) return watch[1];
  // youtube.com/embed/<id>
  const embed = trimmed.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/);
  if (embed) return embed[1];
  // youtube.com/shorts/<id>
  const shorts = trimmed.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/);
  if (shorts) return shorts[1];
  // raw id
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

export async function fetchYoutubeTitle(url: string): Promise<string | null> {
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      url
    )}&format=json`;
    const res = await fetch(oembed);
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return data.title ?? null;
  } catch {
    return null;
  }
}
