import { describe, expect, it } from "vitest";
import { checkScript, checkShotList } from "../src/checks.js";
import { Script as ScriptSchema, type Script, type ShotList } from "../src/schemas.js";

const script: Script = {
  title: "Ask your circle",
  hook: "Need a plumber at 9pm?",
  cta: "Try Hyv today",
  scenes: [
    { id: "s1", duration_s: 3, vo: "Need a plumber at nine pm?", visual_idea: "Leaking tap" },
    { id: "s2", duration_s: 12, vo: "Your friends already know a good one. Hyv asks them for you.", visual_idea: "Phone" },
    { id: "s3", duration_s: 15, vo: "Get it done through people you trust. Try Hyv today.", visual_idea: "Fixed tap" },
  ],
};

const shot = (id: string, scene_id: string, duration_s: number) => ({
  id,
  scene_id,
  duration_s,
  description: "x",
  camera: { angle: "eye level", move: "static", lens: "35mm" },
  kind: "video" as const,
  visual_prompt: "a tap",
  negative_prompt: "",
});

const shotList: ShotList = {
  consistency: { characters: "a", wardrobe: "b", palette: "c", lighting: "d" },
  shots: [shot("sh1", "s1", 3), shot("sh2", "s2", 6), shot("sh3", "s2", 6), shot("sh4", "s3", 8), shot("sh5", "s3", 7)],
};

describe("checkScript", () => {
  it("accepts a well-formed script", () => {
    expect(checkScript(script, 30, 2.5)).toEqual({ errors: [], warnings: [] });
  });

  it("rejects durations that don't match the job", () => {
    expect(checkScript(script, 60, 2.5).errors[0]).toMatch(/add up to 30s but the job is 60s/);
  });

  it("rejects voiceover far too long for the duration", () => {
    const long = { ...script, scenes: [{ ...script.scenes[0], duration_s: 30, vo: "word ".repeat(100) }] };
    expect(checkScript(long, 30, 2.5).errors.join()).toMatch(/100 words/);
  });

  it("rejects hype words", () => {
    const hype = { ...script, cta: "The most revolutionary app" };
    expect(checkScript(hype, 30, 2.5).errors.join()).toMatch(/revolutionary/);
  });

  it("warns when the hook scene is long", () => {
    const slow = { ...script, scenes: [{ ...script.scenes[0], duration_s: 6 }, { ...script.scenes[1], duration_s: 9 }, script.scenes[2]] };
    expect(checkScript(slow, 30, 2.5).warnings.join()).toMatch(/first 2s/);
  });
});

describe("checkShotList", () => {
  it("accepts a matching shot list", () => {
    expect(checkShotList(shotList, script)).toEqual({ errors: [], warnings: [] });
  });

  it("flags uncovered scenes, unknown scenes and duration mismatch", () => {
    const bad = { ...shotList, shots: [shot("sh1", "s1", 3), shot("sh2", "s9", 6)] };
    const { errors } = checkShotList(bad, script);
    expect(errors.join("\n")).toMatch(/unknown scenes: sh2/);
    expect(errors.join("\n")).toMatch(/no shots: s2, s3/);
    expect(errors.join("\n")).toMatch(/add up to 9s/);
  });

  it("flags duplicate shot ids", () => {
    const dup = { ...shotList, shots: [...shotList.shots.slice(0, 4), { ...shotList.shots[4], id: "sh1" }] };
    expect(checkShotList(dup, script).errors.join()).toMatch(/Duplicate shot ids: sh1/);
  });
});

describe("ids", () => {
  it("rejects scene ids that could escape the job folder", () => {
    const bad = { ...script, scenes: [{ ...script.scenes[0], id: "../../etc" }] };
    expect(ScriptSchema.safeParse(bad).success).toBe(false);
    expect(ScriptSchema.safeParse(script).success).toBe(true);
  });
});
