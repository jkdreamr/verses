export type Song = {
  id: string;
  user_id: string | null;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type SongVersion = {
  id: string;
  song_id: string;
  content: string;
  saved_at: string;
};

export type YoutubeMarker = {
  id: string;
  time: number;
  label: string;
};

export type YoutubeSession = {
  id: string;
  song_id: string;
  youtube_url: string;
  youtube_title: string | null;
  markers?: YoutubeMarker[];
  loop_start?: number | null;
  loop_end?: number | null;
};

export type DatamuseWord = {
  word: string;
  score: number;
  numSyllables?: number;
};

export type TakeMeta = {
  id: string;
  song_id: string;
  label: string;
  mime: string;
  duration: number;
  size: number;
  has_video: boolean;
  created_at: string;
};

export type Take = TakeMeta & {
  blob: Blob;
};

export type StudioTrack = {
  id: string;
  label: string;
  blob: Blob;
  mime: string;
  duration: number;
  /** 0..1.5 (allow small over-unity to compensate for quiet mics) */
  volume: number;
  muted: boolean;
  solo: boolean;
  created_at: string;
};

export type StudioSession = {
  id: string;
  song_id: string;
  master_volume: number;
  tracks: StudioTrack[];
  updated_at: string;
};
