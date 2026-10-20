import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { ffmpeg, python, run } from "../media/proc.js";
import type { Job } from "../schemas.js";

export type Engine = "kokoro" | "say";

export interface VoiceChoice {
  engine: Engine;
  voice: string;
}

// Kokoro voice ids start with a language letter: a = American, b = British, h = Hindi.
const KOKORO_VOICE = /^[abh][fm]_[a-z]+$/;

export const VOICE_HELP =
  "Kokoro (default, best quality): af_heart, af_bella, am_michael, am_fenrir (US English), bf_emma, bm_george " +
  "(UK English), hf_alpha, hf_beta, hm_omega, hm_psi (Hindi, Devanagari text). macOS voices: Aman, Tara, Rishi " +
  "(Indian English; best for Hinglish in Roman script), Lekha (Hindi). For dialogue, set `voice` on each scene of the " +
  "script (one voice per character); scenes without one use this voice.";

const DEFAULTS: Record<Job["language"], VoiceChoice> = {
  en: { engine: "kokoro", voice: "af_heart" },
  hi: { engine: "kokoro", voice: "hf_alpha" },
  hinglish: { engine: "say", voice: "Aman" },
};

const SAY_FALLBACK: Record<Job["language"], string> = { en: "Aman", hi: "Lekha", hinglish: "Aman" };

export async function kokoroAvailable(): Promise<boolean> {
  try {
    await access(config.venvPython);
    return true;
  } catch {
    return false;
  }
}

export function chooseVoice(
  language: Job["language"],
  requested: string | undefined,
  setting: "auto" | Engine,
  hasKokoro: boolean,
): VoiceChoice {
  let choice: VoiceChoice = requested
    ? { engine: KOKORO_VOICE.test(requested) ? "kokoro" : "say", voice: requested }
    : DEFAULTS[language];
  if (setting === "say" && choice.engine === "kokoro") choice = { engine: "say", voice: SAY_FALLBACK[language] };
  if (choice.engine === "kokoro" && !hasKokoro) choice = { engine: "say", voice: SAY_FALLBACK[language] };
  return choice;
}

export interface VoiceGroup {
  choice: VoiceChoice;
  sceneIds: string[];
}

// One entry per distinct voice, in the order voices first appear. A scene's own `voice` wins over the
// job-wide `requested` voice; both go through chooseVoice, so engine fallbacks apply to every line.
export function planVoices(
  scenes: { id: string; voice?: string }[],
  language: Job["language"],
  requested: string | undefined,
  setting: "auto" | Engine,
  hasKokoro: boolean,
): VoiceGroup[] {
  const groups = new Map<string, VoiceGroup>();
  for (const scene of scenes) {
    const choice = chooseVoice(language, scene.voice?.trim() || requested, setting, hasKokoro);
    const key = `${choice.engine}:${choice.voice}`;
    const group = groups.get(key) ?? { choice, sceneIds: [] };
    group.sceneIds.push(scene.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export interface SpeechItem {
  text: string;
  out: string; // absolute .wav path
}

export async function synthesize(choice: VoiceChoice, speed: number, items: SpeechItem[]): Promise<void> {
  if (!items.length) return;
  if (choice.engine === "kokoro") {
    const script = path.join(config.projectRoot, "src", "py", "kokoro_tts.py");
    await python(script, { lang_code: choice.voice[0], voice: choice.voice, speed, items });
    return;
  }
  // macOS `say` writes AIFF; convert to 48 kHz WAV so every clip has the same format.
  const tmp = await mkdtemp(path.join(tmpdir(), "hyv-say-"));
  try {
    for (const [i, item] of items.entries()) {
      const textFile = path.join(tmp, `${i}.txt`);
      const aiff = path.join(tmp, `${i}.aiff`);
      await writeFile(textFile, item.text);
      await run("say", ["-v", choice.voice, "-r", String(Math.round(175 * speed)), "-f", textFile, "-o", aiff]);
      await ffmpeg(["-i", aiff, "-ar", "48000", item.out]);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
