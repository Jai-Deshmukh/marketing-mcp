import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { captionCues, chunkText, titleCues } from "../src/media/captions.js";
import { extFor, fetchMedia, isPrivateAddress, kindForExt } from "../src/media/download.js";
import { contrastText, hexOr, kenBurnsFilter, reframeFilter } from "../src/media/layout.js";
import { listTracks, moods, pickTrack } from "../src/music.js";
import type { Script } from "../src/schemas.js";
import { chooseVoice } from "../src/voice/tts.js";

const script: Script = {
  title: "t",
  hook: "h",
  cta: "c",
  scenes: [
    { id: "s1", duration_s: 3, vo: "Need a plumber at nine pm?", on_screen_text: "9pm. Leak.", visual_idea: "x" },
    { id: "s2", duration_s: 5, vo: "", visual_idea: "x" },
    { id: "s3", duration_s: 6, vo: "Your circle knows one. Hyv asks them for you, in one tap.", visual_idea: "x" },
  ],
};

describe("captions", () => {
  it("chunks at punctuation and max length", () => {
    expect(chunkText("Your circle knows one. Hyv asks them for you, in one tap.")).toEqual([
      "Your circle knows one.",
      "Hyv asks them for you,",
      "in one tap.",
    ]);
    expect(chunkText("one two three four five six seven eight", 6)).toEqual(["one two three four", "five six seven eight"]);
  });

  it("never leaves a single dangling word", () => {
    expect(chunkText("Your friends already know a good plumber.")).toEqual(["Your friends already know", "a good plumber."]);
    expect(chunkText("one two three four five six seven", 6)).toEqual(["one two three four", "five six seven"]);
  });

  it("times cues within each scene from the spoken duration", () => {
    const cues = captionCues(script, { s1: 2, s3: 4.5 });
    expect(cues[0]).toEqual({ start: 0, end: 2, text: "Need a plumber at nine pm?" });
    const s3 = cues.slice(1);
    expect(s3[0].start).toBe(8);
    expect(s3.at(-1)!.end).toBe(12.5);
    for (let i = 1; i < s3.length; i++) expect(s3[i].start).toBeCloseTo(s3[i - 1].end, 1);
  });

  it("never lets captions run past the scene, and skips silent scenes", () => {
    const cues = captionCues(script, { s1: 9 });
    expect(cues[0].end).toBe(3);
    expect(cues.some((c) => c.start >= 3 && c.start < 8)).toBe(false);
  });

  it("shows on-screen text for its whole scene", () => {
    expect(titleCues(script)).toEqual([{ start: 0, end: 3, text: "9pm. Leak." }]);
  });
});

describe("layout", () => {
  it("falls back for invalid hex colours and picks legible text", () => {
    expect(hexOr("#TODO", "#2B2D42")).toBe("#2B2D42");
    expect(hexOr("#ff8800", "#000000")).toBe("#ff8800");
    expect(contrastText("#FFB703")).toBe("#111111");
    expect(contrastText("#2B2D42")).toBe("#FFFFFF");
  });

  it("builds zoom and reframe filters for the canvas", () => {
    expect(kenBurnsFilter({ width: 1080, height: 1920 }, 2)).toContain("d=60:s=1080x1920:fps=30");
    expect(reframeFilter({ width: 1920, height: 1080 }, "0:v", "base")).toMatch(/^\[0:v\]split.*\[base\]$/);
  });
});

describe("download helpers", () => {
  it("detects file type from content-type, then from the URL", () => {
    expect(extFor("image/png; charset=binary", "https://cdn.x/a")).toBe(".png");
    expect(extFor("application/octet-stream", "https://cdn.x/clip.MP4?sig=1")).toBe(".mp4");
    expect(extFor(null, "/Users/me/a.txt")).toBeUndefined();
    expect(kindForExt(".JPG")).toBe("image");
    expect(kindForExt(".mov")).toBe("video");
  });
});

describe("download safety", () => {
  it("classifies private and public addresses", () => {
    const blocked = [
      "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.5", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::",
      "fd00::1", "fe80::1", "ff02::1",
      // IPv6 forms that embed IPv4 (these slipped past the old string-prefix check)
      "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "2002:7f00:1::", "::127.0.0.1",
      "not-an-ip",
    ];
    for (const ip of blocked) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "104.18.2.3", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("refuses local-network URLs and non-http schemes before connecting", async () => {
    await expect(fetchMedia("http://127.0.0.1:8765/a.png", "/tmp/x")).rejects.toThrow(/local or private network/);
    await expect(fetchMedia("http://169.254.169.254/latest/meta-data", "/tmp/x")).rejects.toThrow(/local or private network/);
    await expect(fetchMedia("http://localhost/a.png", "/tmp/x")).rejects.toThrow(/local or private network/);
    await expect(fetchMedia("http://[::ffff:127.0.0.1]:8765/a.png", "/tmp/x")).rejects.toThrow(/local or private network/);
    await expect(fetchMedia("http://[64:ff9b::7f00:1]/a.png", "/tmp/x")).rejects.toThrow(/local or private network/);
  });
});

describe("music library", () => {
  let dir: string;
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("reads moods from folders and picks by mood", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "hyv-music-"));
    await mkdir(path.join(dir, "upbeat"));
    await mkdir(path.join(dir, "calm"));
    await writeFile(path.join(dir, "upbeat", "a.mp3"), "");
    await writeFile(path.join(dir, "upbeat", "b.mp3"), "");
    await writeFile(path.join(dir, "calm", "rain.m4a"), "");
    await writeFile(path.join(dir, "loose.wav"), "");
    await writeFile(path.join(dir, "notes.txt"), "");

    const tracks = await listTracks(dir);
    expect(tracks).toHaveLength(4);
    expect(moods(tracks)).toEqual(["any", "calm", "upbeat"]);
    expect(pickTrack(tracks, "Upbeat")!.title).toBe("a");
    expect(pickTrack(tracks, "upbeat", 1)!.title).toBe("b");
    expect(pickTrack(tracks, "rain")!.mood).toBe("calm");
    expect(pickTrack(tracks, "epic")).toBeUndefined();
    expect(await listTracks(path.join(dir, "missing"))).toEqual([]);
  });
});

describe("voice choice", () => {
  it("defaults by language and respects engine availability", () => {
    expect(chooseVoice("en", undefined, "auto", true)).toEqual({ engine: "kokoro", voice: "af_heart" });
    expect(chooseVoice("hi", undefined, "auto", true)).toEqual({ engine: "kokoro", voice: "hf_alpha" });
    expect(chooseVoice("hinglish", undefined, "auto", true)).toEqual({ engine: "say", voice: "Aman" });
    expect(chooseVoice("en", undefined, "auto", false)).toEqual({ engine: "say", voice: "Aman" });
    expect(chooseVoice("en", undefined, "say", true)).toEqual({ engine: "say", voice: "Aman" });
  });

  it("routes a requested voice to the right engine", () => {
    expect(chooseVoice("en", "bm_george", "auto", true)).toEqual({ engine: "kokoro", voice: "bm_george" });
    expect(chooseVoice("en", "Tara", "auto", true)).toEqual({ engine: "say", voice: "Tara" });
  });
});
