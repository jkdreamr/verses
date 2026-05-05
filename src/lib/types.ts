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

export type YoutubeSession = {
  id: string;
  song_id: string;
  youtube_url: string;
  youtube_title: string | null;
};

export type DatamuseWord = {
  word: string;
  score: number;
  numSyllables?: number;
};
