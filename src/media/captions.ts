import type { Script } from "../schemas.js";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);

// Split a line into caption chunks of at most `maxWords`. Breaks at punctuation first, then
// splits long phrases into even parts so no chunk is left with a single dangling word.
export function chunkText(text: string, maxWords = 6): string[] {
  const phrases: string[][] = [];
  let current: string[] = [];
  for (const word of words(text)) {
    current.push(word);
    if (/[.,!?;:।]$/.test(word)) {
      phrases.push(current);
      current = [];
    }
  }
  if (current.length) phrases.push(current);

  return phrases.flatMap((phrase) => {
    const parts = Math.ceil(phrase.length / maxWords);
    const size = Math.ceil(phrase.length / parts);
    const chunks: string[] = [];
    for (let i = 0; i < phrase.length; i += size) chunks.push(phrase.slice(i, i + size).join(" "));
    return chunks;
  });
}

export function sceneStarts(script: Script): number[] {
  let t = 0;
  return script.scenes.map((s) => {
    const start = t;
    t += s.duration_s;
    return start;
  });
}

/**
 * Caption cues timed to the voiceover. Each scene's chunks share the spoken duration
 * (from the voiceover clip, else the scene length) in proportion to their word count.
 */
export function captionCues(script: Script, spokenDuration: Record<string, number>): Cue[] {
  const starts = sceneStarts(script);
  const cues: Cue[] = [];
  script.scenes.forEach((scene, i) => {
    const chunks = chunkText(scene.vo);
    if (!chunks.length) return;
    const span = Math.min(spokenDuration[scene.id] ?? scene.duration_s, scene.duration_s);
    const total = chunks.reduce((n, c) => n + words(c).length, 0);
    let t = starts[i];
    for (const chunk of chunks) {
      const length = (span * words(chunk).length) / total;
      cues.push({ start: round2(t), end: round2(t + length), text: chunk });
      t += length;
    }
  });
  return cues;
}

// On-screen text overlays: shown for the whole scene.
export function titleCues(script: Script): Cue[] {
  const starts = sceneStarts(script);
  return script.scenes.flatMap((scene, i) =>
    scene.on_screen_text?.trim()
      ? [{ start: starts[i], end: round2(starts[i] + scene.duration_s), text: scene.on_screen_text.trim() }]
      : [],
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
