import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { copyFile, rm, stat } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { UserFacingError } from "../jobs/tasks.js";

const MAX_BYTES = 1024 ** 3; // 1 GB
const MAX_REDIRECTS = 5;

const TYPE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);

export function kindForExt(ext: string): "image" | "video" | undefined {
  const e = ext.toLowerCase();
  return IMAGE_EXT.has(e) ? "image" : VIDEO_EXT.has(e) ? "video" : undefined;
}

export function extFor(contentType: string | null, source: string): string | undefined {
  const fromType = contentType ? TYPE_EXT[contentType.split(";")[0].trim().toLowerCase()] : undefined;
  if (fromType) return fromType;
  let pathname = source;
  try {
    pathname = new URL(source).pathname;
  } catch {
    // a local path
  }
  const ext = path.extname(pathname).toLowerCase();
  return kindForExt(ext) ? ext : undefined;
}

// Loopback, private, link-local (incl. cloud metadata 169.254.169.254), CGNAT, multicast and reserved ranges.
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff");
}

// Generated media lives on public CDNs; refuse anything that resolves into the local network.
async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UserFacingError(`Unsupported URL scheme: ${url.protocol}`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string }[];
  try {
    addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  } catch {
    throw new UserFacingError(`Couldn't resolve ${url.hostname}.`);
  }
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UserFacingError(
      `${url.hostname} is a local or private network address. Only public URLs can be downloaded; for a file on this Mac, pass its absolute path instead.`,
    );
  }
}

// Follows redirects by hand so every hop is checked against the private-address rule.
async function fetchPublic(source: string): Promise<Response> {
  let url = new URL(source);
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(url);
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(180_000) });
    } catch (err) {
      throw new UserFacingError(`Couldn't download ${source}: ${(err as Error).message}`);
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    if (hop >= MAX_REDIRECTS) throw new UserFacingError(`Too many redirects for ${source}.`);
    url = new URL(location, url);
  }
}

/**
 * Fetches a public http(s) URL or copies a local file to `destBase` + detected extension.
 * Returns the written path.
 */
export async function fetchMedia(source: string, destBase: string): Promise<string> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetchPublic(source);
    if (!res.ok || !res.body) throw new UserFacingError(`Download failed (HTTP ${res.status}) for ${source}. The link may have expired.`);
    const ext = extFor(res.headers.get("content-type"), source);
    if (!ext) throw new UserFacingError(`${source} is not an image or video (content-type ${res.headers.get("content-type")}).`);
    if (Number(res.headers.get("content-length")) > MAX_BYTES) throw new UserFacingError(`${source} is larger than 1 GB.`);

    const dest = destBase + ext;
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, done) {
        bytes += chunk.length;
        done(bytes > MAX_BYTES ? new UserFacingError(`${source} is larger than 1 GB.`) : null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as never), limit, createWriteStream(dest));
    } catch (err) {
      await rm(dest, { force: true });
      throw err instanceof UserFacingError ? err : new UserFacingError(`Download of ${source} was interrupted.`);
    }
    return dest;
  }

  const local = source.startsWith("file://") ? new URL(source).pathname : source;
  if (!path.isAbsolute(local)) throw new UserFacingError(`"${source}" must be an http(s) URL or an absolute file path.`);
  const ext = extFor(null, local);
  if (!ext) throw new UserFacingError(`${local} is not a supported image (png/jpg/webp) or video (mp4/mov/webm).`);
  try {
    await stat(local);
  } catch {
    throw new UserFacingError(`File not found: ${local}`);
  }
  const dest = destBase + ext;
  await copyFile(local, dest);
  return dest;
}
