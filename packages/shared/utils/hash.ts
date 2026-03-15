import { createHash } from "crypto";

export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function buildManifestHash(manifest: object): string {
  return sha256(JSON.stringify(manifest));
}
