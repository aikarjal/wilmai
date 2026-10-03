import { open } from "node:fs/promises";
import { resolve } from "node:path";
import type { NewsResource } from "@wilm-ai/wilma-client";

export const MAX_NEWS_RESOURCE_BYTES = 50 * 1024 * 1024;

export function normalizeResourceId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return /^\d+$/.test(raw) ? `resource-${raw}` : raw;
}

export function fileNameFromResponse(
  resource: NewsResource,
  contentDisposition: string | null,
  contentType: string | null
): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition ?? "")?.[1];
  const quoted = /filename="([^"]+)"/i.exec(contentDisposition ?? "")?.[1];
  const plain = /filename=([^;]+)/i.exec(contentDisposition ?? "")?.[1]?.trim();
  let name = encoded ? decodeURIComponentSafely(encoded) : quoted ?? plain ?? resource.fileName ?? resource.label;
  name = sanitizeFileName(name) || "wilma-resource";
  if (!/\.[A-Za-z0-9]{1,8}$/.test(name)) {
    const extension = extensionForContentType(contentType);
    if (extension) name += extension;
  }
  return name;
}

/**
 * A file name that is safe to create in the download folder on any OS: no
 * path separators or reserved characters, no control or text-direction
 * characters (which can disguise an extension), no leading dot (hidden files,
 * ".npmrc"-style config), and none of Windows' reserved device names.
 */
export function sanitizeFileName(value: string): string {
  let name = value
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g, "_");
  // Trim spaces and dots together until stable: " .npmrc" -> "npmrc".
  name = name.replace(/^[\s.]+|[\s.]+$/g, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) name = `_${name}`;
  return name.slice(0, 180).replace(/[\s.]+$/g, "");
}

function extensionForContentType(contentType: string | null): string {
  const extensions: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "text/plain": ".txt",
    "text/csv": ".csv",
  };
  return contentType ? extensions[contentType] ?? "" : "";
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function createUniqueDownloadFile(directory: string, preferredName: string) {
  const dot = preferredName.lastIndexOf(".");
  const hasExtension = dot > 0;
  const stem = hasExtension ? preferredName.slice(0, dot) : preferredName;
  const extension = hasExtension ? preferredName.slice(dot) : "";
  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? preferredName : `${stem}-${index}${extension}`;
    const path = resolve(directory, candidate);
    try {
      const handle = await open(path, "wx", 0o600);
      return { path, handle };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }
  throw new Error("Could not choose a unique output filename");
}

/** Read a fetched resource into memory, enforcing the same 50 MB cap as CLI downloads. */
export async function readResponseCapped(response: {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}): Promise<Buffer> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`News resource download failed with HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_NEWS_RESOURCE_BYTES) {
    await response.body?.cancel();
    throw new Error("News resource exceeds the 50 MB download limit");
  }
  if (!response.body) throw new Error("News resource response had no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_NEWS_RESOURCE_BYTES) {
      await reader.cancel();
      throw new Error("News resource exceeds the 50 MB download limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
