import { readdir } from "node:fs/promises";
import path from "node:path";

const AUDIO = /\.(mp3|m4a|aac|wav|flac|ogg)$/i;

export interface Track {
  file: string;
  title: string;
  mood: string;
}

/**
 * Library layout: one folder per mood, e.g. music/upbeat/sunny-day.mp3.
 * Files directly in the music folder get the mood "any".
 */
export async function listTracks(dir: string): Promise<Track[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && AUDIO.test(e.name))
    .map((e) => {
      const file = path.join(e.parentPath, e.name);
      const rel = path.relative(dir, file).split(path.sep);
      return { file, title: path.parse(e.name).name, mood: rel.length > 1 ? rel[0].toLowerCase() : "any" };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function moods(tracks: Track[]): string[] {
  return [...new Set(tracks.map((t) => t.mood))].sort();
}

// Exact mood folder first, then a partial match on mood or title. Rotates through matches with `seed`.
export function pickTrack(tracks: Track[], mood: string, seed = 0): Track | undefined {
  const m = mood.toLowerCase().trim();
  const exact = tracks.filter((t) => t.mood === m);
  const loose = tracks.filter((t) => t.mood.includes(m) || m.includes(t.mood) || t.title.toLowerCase().includes(m));
  const pool = exact.length ? exact : loose;
  return pool.length ? pool[seed % pool.length] : undefined;
}
