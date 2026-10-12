import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { createWriteStream } from "node:fs";
import { copyFile, rm, stat } from "node:fs/promises";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import path from "node:path";
import { Transform } from "node:stream";
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

// Everything that isn't public unicast. IPv6 forms that embed an IPv4 address (mapped, NAT64,
// 6to4, Teredo, IPv4-compatible) are blocked outright: they're how string-prefix checks get bypassed.
// Separate lists per family: BlockList matches IPv4 addresses against IPv6 rules via ::ffff:a.b.c.d,
// so one shared list with ::ffff:0:0/96 would block every IPv4 address.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED_V4.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 96], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) BLOCKED_V6.addSubnet(net, bits, "ipv6");
BLOCKED_V6.addAddress("::1", "ipv6");

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (!family) return true; // not an IP at all: never treat as safe
  return family === 4 ? BLOCKED_V4.check(ip, "ipv4") : BLOCKED_V6.check(ip, "ipv6");
}

const privateHostError = (host: string) =>
  new UserFacingError(
    `${host} is a local or private network address. Only public URLs can be downloaded; for a file on this Mac, pass its absolute path instead.`,
  );

// Used as the socket's DNS lookup, so the address that is checked is the one we connect to
// (no gap for DNS rebinding between a check and the real request).
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) return callback(privateHostError(hostname), "", 0);
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

function request(url: URL): Promise<IncomingMessage> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Promise.reject(new UserFacingError(`Unsupported URL scheme: ${url.protocol}`));
  }
  // IP literals skip DNS lookup entirely, so check them here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) return Promise.reject(privateHostError(url.hostname));
  const get = url.protocol === "https:" ? httpsGet : httpGet;
  return new Promise((resolve, reject) => {
    const req = get(url, { lookup: publicLookup, timeout: 60_000 }, resolve);
    req.on("timeout", () => req.destroy(new UserFacingError(`Download of ${url.href} timed out.`)));
    req.on("error", reject);
  });
}

// Follows redirects by hand so every hop goes through the same checks.
async function getPublic(source: string): Promise<IncomingMessage> {
  let url = new URL(source);
  for (let hop = 0; ; hop++) {
    let res: IncomingMessage;
    try {
      res = await request(url);
    } catch (err) {
      throw err instanceof UserFacingError ? err : new UserFacingError(`Couldn't download ${source}: ${(err as Error).message}`);
    }
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status < 300 || status >= 400 || !location) return res;
    res.resume(); // discard the redirect body
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
    const res = await getPublic(source);
    const status = res.statusCode ?? 0;
    const type = res.headers["content-type"] ?? null;
    if (status < 200 || status >= 300) {
      res.resume();
      throw new UserFacingError(`Download failed (HTTP ${status}) for ${source}. The link may have expired.`);
    }
    const ext = extFor(type, source);
    if (!ext || Number(res.headers["content-length"]) > MAX_BYTES) {
      res.destroy();
      throw new UserFacingError(ext ? `${source} is larger than 1 GB.` : `${source} is not an image or video (content-type ${type}).`);
    }

    const dest = destBase + ext;
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, done) {
        bytes += chunk.length;
        done(bytes > MAX_BYTES ? new UserFacingError(`${source} is larger than 1 GB.`) : null, chunk);
      },
    });
    try {
      await pipeline(res, limit, createWriteStream(dest));
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
