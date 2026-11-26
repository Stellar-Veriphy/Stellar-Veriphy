# API Versioning and Sunset Policy

StellarVeriphy uses route-level deprecation annotations rather than a URL
version prefix. This keeps existing URLs stable while giving consumers enough
lead time to migrate before an endpoint is removed.

## How deprecation works

When a route is marked deprecated in `server.ts`, every response from that
route automatically carries:

### Response headers (RFC 8594)

| Header | Value | Example |
|---|---|---|
| `Deprecation` | `true` | `Deprecation: true` |
| `Sunset` | HTTP-date of removal | `Sunset: Sun, 01 Jun 2027 00:00:00 GMT` |
| `Link` | Replacement endpoint | `Link: </api/v2/verifications>; rel="successor-version"` |

`Sunset` and `Link` are only sent when the route's `sunsetDate` / `successorPath`
are set.

### Response body

A `meta.deprecation` envelope is merged into every JSON response:

```json
{
  "jobId": "...",
  "status": "certified",
  "meta": {
    "deprecation": {
      "deprecated": true,
      "reason": "Replaced by /api/verifications — see docs/api/versioning.md",
      "sunsetDate": "2027-06-01T00:00:00Z",
      "successorPath": "/api/verifications"
    }
  }
}
```

This makes the deprecation discoverable even for clients that do not inspect
headers (e.g. REST clients that only parse the body).

## Discovering deprecated routes

**Authenticated operators** can call `GET /admin/api/deprecated` to get a full
list of deprecated routes including their sunset dates and successors.

**Public callers** can call `GET /api/deprecations` for a list of deprecated
public (non-admin) routes.

Both responses follow the same shape:

```json
{
  "deprecated": [
    {
      "method": "GET",
      "pattern": "^\\/api\\/old-certificates\\/(?<certId>[^/]+)$",
      "reason": "Replaced by /api/certificates/:certId",
      "sunsetDate": "2027-06-01T00:00:00Z",
      "successorPath": "/api/certificates/:certId"
    }
  ]
}
```

`sunsetDate` and `successorPath` are `null` when not set.

## Marking a route as deprecated

In `src/server.ts`, add a `deprecation` field to the route entry:

```typescript
{
  method: "GET",
  pattern: /^\/api\/old-certificates\/(?<certId>[^/]+)$/,
  deprecation: {
    reason: "Replaced by /api/certificates/:certId — see docs/api/versioning.md",
    sunsetDate: "2027-06-01T00:00:00Z",
    successorPath: "/api/certificates/:certId",
  },
  handler: async (_req, res, { certId }) => { /* ... */ },
},
```

## Deprecation lifecycle

1. **Announce**: add `deprecation` to the route; set `sunsetDate` at least 90
   days in the future.
2. **Notify**: the CI and staging deploy logs will surface new deprecations.
3. **Warn**: headers and body envelopes alert consumers automatically.
4. **Remove**: after `sunsetDate`, delete the route from `server.ts` and add a
   migration note to this document.

## Currently deprecated routes

_No routes are currently deprecated._

Deprecated routes will be listed here and in `GET /api/deprecations`.

## Supported versions

| Endpoint prefix | Status | Notes |
|---|---|---|
| `/api/` | ✅ Current | Public API |
| `/admin/` | ✅ Current | Authenticated operator API |
