import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { JobStore } from "../src/jobs/store.js";
import { assemble } from "../src/media/assemble.js";

// Renders real video, so it needs ffmpeg and the Python venv from scripts/setup.sh.
const hasTools = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return existsSync(config.venvPython);
  } catch {
    return false;
  }
})();

const ff = (...args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

// Mean RGB of a 40x40 box centred on (x, y) at time t.
function sample(file: string, t: number, x: number, y: number): number[] {
  const raw = execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1",
    "-vf", `crop=40:40:${x - 20}:${y - 20},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  return [...raw];
}

describe.skipIf(!hasTools)("assemble (integration)", () => {
  let dir: string;
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("keeps overlays on screen across a PNG → JPEG segment boundary", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "hyv-assemble-"));
    const media = path.join(dir, "media");
    await mkdir(media);
    // Plain black stills: a JPEG decodes as full-range yuvj420p, a PNG as rgb. Mixing them used to
    // change the stream format mid-video, rebuild the filter graph and drop every later overlay.
    ff("-f", "lavfi", "-i", "color=black:s=1080x1920", "-frames:v", "1", path.join(media, "a.png"));
    ff("-f", "lavfi", "-i", "color=black:s=1080x1920", "-frames:v", "1", path.join(media, "b.jpg"));

    const store = new JobStore(path.join(dir, "out"));
    const job = await store.create({ brief: "test", format: "reel", duration_s: 4, platform: "instagram", language: "en", aspect_ratio: "9:16" });
    const shot = (id: string, scene_id: string) => ({
      id, scene_id, duration_s: 2, kind: "image" as const, description: id, visual_prompt: "p", negative_prompt: "",
      camera: { angle: "a", move: "m", lens: "l" },
    });
    const asset = (shot_id: string, file: string) => ({ shot_id, file, kind: "image" as const, source: file, added_at: "" });
    const ready = await store.update(job.id, (j) => ({
      ...j,
      script: {
        title: "t", hook: "h", cta: "c",
        scenes: [
          { id: "s1", duration_s: 2, vo: "", visual_idea: "x" },
          { id: "s2", duration_s: 2, vo: "", on_screen_text: "After the boundary", visual_idea: "x" },
        ],
      },
      shot_list: { consistency: { characters: "", wardrobe: "", palette: "", lighting: "" }, shots: [shot("sh1", "s1"), shot("sh2", "s2")] },
      assets: { sh1: asset("sh1", path.join(media, "a.png")), sh2: asset("sh2", path.join(media, "b.jpg")) },
      music: null,
    }));

    const [out] = await assemble(store, ready, { aspect_ratios: ["9:16"], captions: false, end_card: false, placeholders: false, music_volume: 0 });
    expect(out.duration_s).toBeCloseTo(4, 0);

    // The title box (brand accent colour) sits in the upper area; the stills are black.
    const titleCentre = { x: 540, y: Math.round(1920 * 0.14 + 1080 * 0.06 + 40) };
    const [r, g] = sample(out.file, 3, titleCentre.x, titleCentre.y);
    expect(r + g).toBeGreaterThan(200);
    const [r0, g0, b0] = sample(out.file, 1, titleCentre.x, titleCentre.y);
    expect(r0 + g0 + b0).toBeLessThan(40);
  }, 120_000);
});
