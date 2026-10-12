import type { Script, ShotList } from "./schemas.js";

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

// Brand rule: no hype words. Matched as whole words, case-insensitive.
const HYPE_WORDS = [
  "revolutionary", "game-changing", "game changer", "groundbreaking", "unbelievable",
  "insane", "mind-blowing", "best ever", "guaranteed", "world-class", "disruptive", "#1",
];

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

function findHypeWords(text: string): string[] {
  const lower = text.toLowerCase();
  return HYPE_WORDS.filter((w) => lower.includes(w));
}

function duplicateIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
}

export function checkScript(script: Script, durationS: number, wordsPerSecond: number): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const dupes = duplicateIds(script.scenes.map((s) => s.id));
  if (dupes.length) errors.push(`Duplicate scene ids: ${dupes.join(", ")}.`);

  const total = sum(script.scenes.map((s) => s.duration_s));
  if (Math.abs(total - durationS) > Math.max(1, durationS * 0.1)) {
    errors.push(`Scene durations add up to ${round1(total)}s but the job is ${durationS}s. Adjust scene durations.`);
  }

  const words = sum(script.scenes.map((s) => countWords(s.vo)));
  const maxWords = Math.round(durationS * wordsPerSecond);
  if (words > maxWords * 1.25) {
    errors.push(`Voiceover is ${words} words; ${durationS}s fits about ${maxWords}. Cut it down.`);
  } else if (words > maxWords) {
    warnings.push(`Voiceover is ${words} words, slightly over the ~${maxWords} that fit ${durationS}s; it will feel rushed.`);
  }

  for (const scene of script.scenes) {
    const sceneMax = scene.duration_s * wordsPerSecond * 1.25;
    if (countWords(scene.vo) > sceneMax) {
      warnings.push(`Scene ${scene.id}: ${countWords(scene.vo)} words in ${scene.duration_s}s is too fast.`);
    }
  }

  if (script.scenes[0].duration_s > 4) {
    warnings.push(`First scene is ${script.scenes[0].duration_s}s; the hook must land in the first 2s, so keep scene 1 short.`);
  }

  const allText = [script.title, script.hook, script.cta, ...script.scenes.flatMap((s) => [s.vo, s.on_screen_text ?? ""])].join(" ");
  const hype = findHypeWords(allText);
  if (hype.length) errors.push(`Remove hype words (brand rule): ${hype.join(", ")}.`);

  return { errors, warnings };
}

export function checkShotList(shotList: ShotList, script: Script): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { shots } = shotList;

  const dupes = duplicateIds(shots.map((s) => s.id));
  if (dupes.length) errors.push(`Duplicate shot ids: ${dupes.join(", ")}.`);

  const sceneIds = new Set(script.scenes.map((s) => s.id));
  const unknown = shots.filter((s) => !sceneIds.has(s.scene_id)).map((s) => s.id);
  if (unknown.length) errors.push(`Shots reference unknown scenes: ${unknown.join(", ")}.`);

  const covered = new Set(shots.map((s) => s.scene_id));
  const missing = [...sceneIds].filter((id) => !covered.has(id));
  if (missing.length) errors.push(`Scenes with no shots: ${missing.join(", ")}.`);

  const scriptTotal = sum(script.scenes.map((s) => s.duration_s));
  const shotTotal = sum(shots.map((s) => s.duration_s));
  if (Math.abs(shotTotal - scriptTotal) > 1) {
    errors.push(`Shots add up to ${round1(shotTotal)}s but the script is ${round1(scriptTotal)}s.`);
  }

  for (const shot of shots) {
    if (shot.kind === "video" && (shot.duration_s < 2 || shot.duration_s > 10)) {
      warnings.push(`Shot ${shot.id}: ${shot.duration_s}s video; most models generate 3–10s clips.`);
    }
  }

  const hype = findHypeWords(shots.map((s) => s.visual_prompt).join(" "));
  if (hype.length) warnings.push(`Visual prompts contain hype words: ${hype.join(", ")}.`);

  return { errors, warnings };
}
