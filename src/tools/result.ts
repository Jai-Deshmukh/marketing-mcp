import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { JobNotFoundError } from "../jobs/store.js";
import { UserFacingError } from "../jobs/tasks.js";
import { ToolMissingError } from "../media/proc.js";

export function ok(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function fail(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

// Turn expected errors into actionable messages; never leak stack traces to the chat.
export function toErrorResult(err: unknown): CallToolResult {
  if (err instanceof JobNotFoundError || err instanceof UserFacingError || err instanceof ToolMissingError) return fail(err.message);
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    return fail(`Invalid input:\n${issues}`);
  }
  console.error(err);
  return fail("Something went wrong on the Hyv server. Check the server logs.");
}

export const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
