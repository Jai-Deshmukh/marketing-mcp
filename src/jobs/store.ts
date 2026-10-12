import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Job } from "../schemas.js";

const JOB_ID = /^[a-z0-9-]+$/;

export class JobNotFoundError extends Error {}

// One folder per job under outputDir, holding manifest.json and every asset.
export class JobStore {
  constructor(private readonly outputDir: string) {}

  jobDir(id: string): string {
    if (!JOB_ID.test(id)) throw new JobNotFoundError(`Invalid job id "${id}".`);
    return path.join(this.outputDir, id);
  }

  private locks = new Map<string, Promise<unknown>>();

  async create(fields: Omit<Job, "id" | "created_at" | "updated_at" | "stage" | "errors" | "assets" | "outputs" | "tasks">): Promise<Job> {
    const now = new Date().toISOString();
    const job: Job = {
      ...fields,
      id: newJobId(fields.brief),
      created_at: now,
      updated_at: now,
      stage: "script",
      assets: {},
      outputs: [],
      tasks: {},
      errors: [],
    };
    await mkdir(this.jobDir(job.id), { recursive: true });
    await this.write(job);
    return job;
  }

  async get(id: string): Promise<Job> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.jobDir(id), "manifest.json"), "utf8");
    } catch {
      throw new JobNotFoundError(`No job "${id}". Use list_jobs to see existing jobs.`);
    }
    return Job.parse(JSON.parse(raw));
  }

  // Updates to one job are serialized: background tasks and tool calls can overlap.
  update(id: string, change: (job: Job) => Job): Promise<Job> {
    const run = async () => {
      const job = change(await this.get(id));
      job.updated_at = new Date().toISOString();
      await this.write(job);
      return job;
    };
    const next = (this.locks.get(id) ?? Promise.resolve()).then(run, run);
    this.locks.set(id, next.catch(() => {}));
    return next;
  }

  // Absolute path for a manifest path (relative paths are inside the job folder).
  resolve(id: string, file: string): string {
    return path.isAbsolute(file) ? file : path.join(this.jobDir(id), file);
  }

  async list(): Promise<Job[]> {
    let names: string[];
    try {
      names = await readdir(this.outputDir);
    } catch {
      return [];
    }
    const jobs = await Promise.all(names.filter((n) => JOB_ID.test(n)).map((n) => this.get(n).catch(() => null)));
    return jobs.filter((j): j is Job => j !== null).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // Write to a temp file then rename, so a crash never leaves a half-written manifest.
  private async write(job: Job): Promise<void> {
    const file = path.join(this.jobDir(job.id), "manifest.json");
    await writeFile(`${file}.tmp`, JSON.stringify(job, null, 2));
    await rename(`${file}.tmp`, file);
  }
}

function newJobId(brief: string): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const slug = brief.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30).replace(/-$/, "");
  return `${date}-${slug || "job"}-${randomBytes(2).toString("hex")}`;
}
