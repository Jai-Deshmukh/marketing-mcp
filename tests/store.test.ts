import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobNotFoundError, JobStore } from "../src/jobs/store.js";

let dir: string;
let store: JobStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "hyv-jobs-"));
  store = new JobStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const fields = {
  brief: "30s reel about Circles!",
  format: "reel" as const,
  duration_s: 30,
  platform: "instagram" as const,
  language: "en" as const,
  aspect_ratio: "9:16" as const,
};

describe("JobStore", () => {
  it("creates a job with a readable id and reads it back", async () => {
    const job = await store.create(fields);
    expect(job.id).toMatch(/^\d{8}-30s-reel-about-circles-[0-9a-f]{4}$/);
    expect(job.stage).toBe("script");
    expect(await store.get(job.id)).toEqual(job);
  });

  it("updates a job and lists all jobs", async () => {
    const a = await store.create(fields);
    const b = await store.create({ ...fields, brief: "second" });
    await store.update(a.id, (j) => ({ ...j, stage: "shot_list" }));
    expect((await store.get(a.id)).stage).toBe("shot_list");
    expect((await store.list()).map((j) => j.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("rejects missing and path-traversal ids", async () => {
    await expect(store.get("nope")).rejects.toBeInstanceOf(JobNotFoundError);
    await expect(store.get("../etc")).rejects.toBeInstanceOf(JobNotFoundError);
  });

  it("returns an empty list when the output folder doesn't exist", async () => {
    expect(await new JobStore(path.join(dir, "missing")).list()).toEqual([]);
  });
});
