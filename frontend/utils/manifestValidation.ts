/**
 * Validates a manifest object against the expected ContentManifest schema
 * before it is submitted on-chain.
 *
 * Required fields  : contentHash, creator, timestamp
 * Optional fields  : metadata.device, metadata.location, metadata.aiModel
 */

import { isValidSHA256, isValidStellarAddress } from "./validation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// ISO 8601 helper
// ---------------------------------------------------------------------------

/**
 * Returns true if `value` is a non-empty string that parses as a valid
 * ISO 8601 date/datetime (e.g. "2024-01-15" or "2024-01-15T10:30:00Z").
 *
 * We accept any string that:
 *  1. Matches the basic ISO 8601 date or datetime pattern, AND
 *  2. Produces a finite Date when passed to `new Date()`.
 */
function isValidISO8601(value: string): boolean {
  // Covers: YYYY-MM-DD, YYYY-MM-DDTHH:mm:ssZ, YYYY-MM-DDTHH:mm:ss.sssZ,
  //         YYYY-MM-DDTHH:mm:ss±HH:mm, etc.
  const iso8601Regex =
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
  if (!iso8601Regex.test(value)) return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/**
 * Validate a manifest object against the ContentManifest schema.
 *
 * @param manifest  The value to validate (typed as `unknown` so callers can
 *                  pass raw JSON.parse output without casting).
 * @returns         `{ valid: true, errors: [] }` on success, or
 *                  `{ valid: false, errors: [...] }` with one message per
 *                  failing rule.
 */
export function validateManifest(manifest: unknown): ManifestValidationResult {
  const errors: string[] = [];

  // ── Top-level type guard ──────────────────────────────────────────────────
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {
      valid: false,
      errors: ["Manifest must be a non-null object."],
    };
  }

  const m = manifest as Record<string, unknown>;

  // ── Required: contentHash ─────────────────────────────────────────────────
  if (!("contentHash" in m) || m.contentHash === undefined || m.contentHash === null) {
    errors.push("contentHash is required.");
  } else if (typeof m.contentHash !== "string") {
    errors.push("contentHash must be a string.");
  } else if (!isValidSHA256(m.contentHash)) {
    errors.push(
      "contentHash must be a valid SHA-256 hex string (64 hexadecimal characters)."
    );
  }

  // ── Required: creator ────────────────────────────────────────────────────
  if (!("creator" in m) || m.creator === undefined || m.creator === null) {
    errors.push("creator is required.");
  } else if (typeof m.creator !== "string") {
    errors.push("creator must be a string.");
  } else if (!isValidStellarAddress(m.creator)) {
    errors.push(
      "creator must be a valid Stellar public key (starts with 'G', 56 base-32 characters)."
    );
  }

  // ── Required: timestamp ──────────────────────────────────────────────────
  if (!("timestamp" in m) || m.timestamp === undefined || m.timestamp === null) {
    errors.push("timestamp is required.");
  } else if (typeof m.timestamp !== "string") {
    errors.push("timestamp must be a string.");
  } else if (!isValidISO8601(m.timestamp)) {
    errors.push(
      "timestamp must be a valid ISO 8601 date/datetime string (e.g. \"2024-01-15T10:30:00Z\")."
    );
  }

  // ── Optional: metadata ───────────────────────────────────────────────────
  if ("metadata" in m && m.metadata !== undefined && m.metadata !== null) {
    if (typeof m.metadata !== "object" || Array.isArray(m.metadata)) {
      errors.push("metadata must be an object.");
    } else {
      const meta = m.metadata as Record<string, unknown>;

      if ("device" in meta && meta.device !== undefined && meta.device !== null) {
        if (typeof meta.device !== "string") {
          errors.push("metadata.device must be a string.");
        } else if (meta.device.trim() === "") {
          errors.push("metadata.device must not be an empty string.");
        }
      }

      if ("location" in meta && meta.location !== undefined && meta.location !== null) {
        if (typeof meta.location !== "string") {
          errors.push("metadata.location must be a string.");
        } else if (meta.location.trim() === "") {
          errors.push("metadata.location must not be an empty string.");
        }
      }

      if ("aiModel" in meta && meta.aiModel !== undefined && meta.aiModel !== null) {
        if (typeof meta.aiModel !== "string") {
          errors.push("metadata.aiModel must be a string.");
        } else if (meta.aiModel.trim() === "") {
          errors.push("metadata.aiModel must not be an empty string.");
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
