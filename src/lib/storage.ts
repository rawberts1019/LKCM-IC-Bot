import { put, del, head } from "@vercel/blob";
import { env } from "@/env";

export type PutResult = {
  storageKey: string;
  url: string;
  sizeBytes: number;
};

/**
 * Stores raw bytes under a stable key. The storageKey we persist is the full
 * Vercel Blob URL — it's what we pass back to fetch the bytes. When we
 * eventually cut over to S3, the same interface works against an s3:// key.
 */
export async function putObject(
  key: string,
  bytes: Uint8Array | Buffer,
  contentType: string
): Promise<PutResult> {
  if (env.STORAGE_PROVIDER !== "vercel-blob") {
    throw new Error(`Storage provider ${env.STORAGE_PROVIDER} not wired yet.`);
  }
  const result = await put(key, bytes, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    token: env.BLOB_READ_WRITE_TOKEN
  });
  return {
    storageKey: result.url,
    url: result.url,
    sizeBytes: bytes.byteLength
  };
}

export async function getObjectBytes(storageKey: string): Promise<Uint8Array> {
  const res = await fetch(storageKey);
  if (!res.ok) {
    throw new Error(`Failed to fetch object from storage: ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function deleteObject(storageKey: string): Promise<void> {
  if (env.STORAGE_PROVIDER !== "vercel-blob") return;
  await del(storageKey, { token: env.BLOB_READ_WRITE_TOKEN });
}

export async function objectExists(storageKey: string): Promise<boolean> {
  try {
    await head(storageKey, { token: env.BLOB_READ_WRITE_TOKEN });
    return true;
  } catch {
    return false;
  }
}

export function storageKeyForDocument(workspaceId: string, documentId: string, filename: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `workspaces/${workspaceId}/${documentId}/${safeName}`;
}
