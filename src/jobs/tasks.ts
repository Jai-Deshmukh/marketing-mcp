import { ToolMissingError, ProcessError } from "../media/proc.js";
import type { JobStore } from "./store.js";

export class UserFacingError extends Error {}

export type TaskOutcome = { status: "done" | "failed"; message: string } | { status: "running" };

// Tasks running in this server process. A manifest saying "running" for a task not in
// this set is left over from a previous run (e.g. Claude Desktop restarted) and can be restarted.
const active = new Set<string>();

export function describeError(err: unknown): string {
  if (err instanceof UserFacingError || err instanceof ToolMissingError) return err.message;
  if (err instanceof ProcessError) return `${err.message}:\n${err.stderrTail}`;
  console.error(err);
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs slow work (voiceover, rendering) in the background and records its status in the
 * manifest. Waits up to `waitMs` so quick runs return their result directly; otherwise the
 * caller tells the user to check job_status.
 */
export async function runTask(
  store: JobStore,
  jobId: string,
  name: string,
  work: () => Promise<string>,
  waitMs = 45_000,
): Promise<TaskOutcome> {
  const key = `${jobId}:${name}`;
  if (active.has(key)) return { status: "running" };
  active.add(key);

  const started_at = new Date().toISOString();
  await store.update(jobId, (j) => ({ ...j, tasks: { ...j.tasks, [name]: { status: "running", started_at } } }));

  const finished = (async (): Promise<TaskOutcome> => {
    let outcome: TaskOutcome;
    try {
      outcome = { status: "done", message: await work() };
    } catch (err) {
      outcome = { status: "failed", message: describeError(err) };
    } finally {
      active.delete(key);
    }
    await store.update(jobId, (j) => ({
      ...j,
      tasks: { ...j.tasks, [name]: { status: outcome.status as "done" | "failed", started_at, finished_at: new Date().toISOString(), message: outcome.message } },
    }));
    return outcome;
  })();

  const timeout = new Promise<TaskOutcome>((resolve) => setTimeout(() => resolve({ status: "running" }), waitMs).unref());
  return Promise.race([finished, timeout]);
}
