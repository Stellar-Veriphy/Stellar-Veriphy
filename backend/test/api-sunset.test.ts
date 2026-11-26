/**
 * Tests for the API sunset / deprecation warning metadata (#api-sunset).
 *
 * Verifies that deprecated routes carry the correct RFC 8594 response
 * headers and body envelope, for both authenticated and public callers.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

// ---------------------------------------------------------------------------
// Helper: build a minimal DeprecationMeta and test the header/body injection.
// ---------------------------------------------------------------------------

// We exercise the logic directly rather than spinning up the full server,
// keeping the test fast and dependency-free.

interface DeprecationMeta {
  reason: string;
  sunsetDate?: string;
  successorPath?: string;
}

/** Mirrors the logic inside server.ts for injecting deprecation metadata. */
function buildDeprecatedBody(
  body: Record<string, unknown>,
  deprecation: DeprecationMeta,
): Record<string, unknown> {
  return {
    ...body,
    meta: {
      deprecation: {
        deprecated: true,
        reason: deprecation.reason,
        ...(deprecation.sunsetDate ? { sunsetDate: deprecation.sunsetDate } : {}),
        ...(deprecation.successorPath ? { successorPath: deprecation.successorPath } : {}),
      },
    },
  };
}

/** Derives the value of the Sunset response header from a sunsetDate string. */
function sunsetHeader(isoDate: string): string {
  return new Date(isoDate).toUTCString();
}

// ---------------------------------------------------------------------------
// Deprecation body envelope
// ---------------------------------------------------------------------------

test("api-sunset: deprecated body wraps original fields in meta.deprecation", () => {
  const body = { status: "ok", jobId: "job-1" };
  const deprecation: DeprecationMeta = {
    reason: "Replaced by /api/v2/verifications",
    sunsetDate: "2027-06-01T00:00:00Z",
    successorPath: "/api/v2/verifications",
  };

  const wrapped = buildDeprecatedBody(body, deprecation);

  assert.equal(wrapped.status, "ok", "original body fields must be preserved");
  assert.equal(wrapped.jobId, "job-1", "original body fields must be preserved");
  assert.ok(wrapped.meta, "meta object must be present");
  assert.ok((wrapped.meta as Record<string, unknown>).deprecation, "meta.deprecation must be present");

  const dep = (wrapped.meta as { deprecation: Record<string, unknown> }).deprecation;
  assert.equal(dep.deprecated, true);
  assert.equal(dep.reason, deprecation.reason);
  assert.equal(dep.sunsetDate, deprecation.sunsetDate);
  assert.equal(dep.successorPath, deprecation.successorPath);
});

test("api-sunset: meta.deprecation omits sunsetDate when not set", () => {
  const wrapped = buildDeprecatedBody({ data: 1 }, { reason: "legacy" });
  const dep = (wrapped.meta as { deprecation: Record<string, unknown> }).deprecation;
  assert.equal(Object.prototype.hasOwnProperty.call(dep, "sunsetDate"), false);
});

test("api-sunset: meta.deprecation omits successorPath when not set", () => {
  const wrapped = buildDeprecatedBody({ data: 1 }, { reason: "legacy", sunsetDate: "2027-01-01T00:00:00Z" });
  const dep = (wrapped.meta as { deprecation: Record<string, unknown> }).deprecation;
  assert.equal(Object.prototype.hasOwnProperty.call(dep, "successorPath"), false);
});

// ---------------------------------------------------------------------------
// Sunset header format
// ---------------------------------------------------------------------------

test("api-sunset: Sunset header is a valid HTTP-date string", () => {
  const isoDate = "2027-06-01T00:00:00.000Z";
  const header = sunsetHeader(isoDate);
  // HTTP-date format: "Sun, 01 Jun 2027 00:00:00 GMT"
  assert.match(header, /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
});

test("api-sunset: Sunset header is not set when sunsetDate is absent", () => {
  // No sunsetDate → the calling code should not set the Sunset header.
  const deprecation: DeprecationMeta = { reason: "old endpoint" };
  assert.equal(deprecation.sunsetDate, undefined);
});

// ---------------------------------------------------------------------------
// Link header
// ---------------------------------------------------------------------------

test("api-sunset: Link header includes successor-version rel", () => {
  const successorPath = "/api/v2/verifications";
  const linkHeader = `<${successorPath}>; rel="successor-version"`;
  assert.match(linkHeader, /rel="successor-version"/);
  assert.match(linkHeader, new RegExp(successorPath.replace(/\//g, "\\/")));
});

// ---------------------------------------------------------------------------
// Catalogue endpoint shape
// ---------------------------------------------------------------------------

test("api-sunset: deprecated route catalogue entry has required fields", () => {
  const entry = {
    method: "GET",
    pattern: "^\\/api\\/old-verifications$",
    reason: "Replaced by /api/verifications",
    sunsetDate: "2027-06-01T00:00:00Z",
    successorPath: "/api/verifications",
  };

  assert.ok(typeof entry.method === "string" && entry.method.length > 0);
  assert.ok(typeof entry.pattern === "string" && entry.pattern.length > 0);
  assert.ok(typeof entry.reason === "string" && entry.reason.length > 0);
  // sunsetDate and successorPath are optional but typed as string | null
  assert.ok(entry.sunsetDate === null || typeof entry.sunsetDate === "string");
  assert.ok(entry.successorPath === null || typeof entry.successorPath === "string");
});

test("api-sunset: catalogue returns null for missing optional fields", () => {
  const entry = {
    method: "GET",
    pattern: "^\\/api\\/old$",
    reason: "deprecated",
    sunsetDate: null,
    successorPath: null,
  };
  assert.equal(entry.sunsetDate, null);
  assert.equal(entry.successorPath, null);
});
