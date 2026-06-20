---
name: Canvas LMS proxy hardening
description: Why the api-server Canvas proxy must validate the user-supplied base URL before fetching.
---

The Canvas proxy (`artifacts/api-server/src/routes/canvas.ts`) forwards a user-supplied
`baseUrl` plus a bearer token to an outbound `fetch`. Any route that does this must
validate the host before fetching.

**Rule:** require `https://` (reject `http://` so the token never transits in clear text)
and block internal targets — `localhost`, `*.local`/`*.internal`, bare hostnames with no
dot, and IP literals in loopback/private/link-local/CGNAT ranges (notably the cloud
metadata IP `169.254.169.254`). Return `400 INVALID_BASE_URL` on failure. Validate once
per route, then pass the normalized origin into the fetch helpers.

**Two non-obvious gaps the first pass missed (caught in review):**
1. **Pagination is attacker-controlled.** Canvas returns the next-page URL in the
   `Link: rel="next"` header. Following it blindly re-opens SSRF/token-leak: a host you
   allowed can hand back an `http://` or internal `next` URL and the proxy fetches it
   *with the bearer token*. Only follow `next` when it is same-origin AND https.
2. **String host checks don't stop DNS-based SSRF.** A public-looking domain
   (e.g. `localtest.me`) can resolve to `127.0.0.1`. Resolve the host (`dns.lookup`,
   `all: true`) and reject if any address is in a blocked range. (TOCTOU remains since
   `fetch` re-resolves, but it raises the bar materially.)

**Why:** without this the proxy is an SSRF vector (server can be coaxed into hitting
internal services) and can leak the Canvas token over plaintext HTTP. The token is
intentionally never stored server-side; this guard keeps that promise meaningful.

**How to apply:** any time you add a server route that fetches a client-provided URL,
reuse the same allow/deny shape (`validateCanvasBase` / `isBlockedIpHost`).
