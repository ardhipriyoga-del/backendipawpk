---
name: Operating theatre integration
description: Session, cache, and network behavior for the Pasien Rencana Tindakan dashboard.
---

The operating-theatre dashboard uses the configurable TrakCare endpoint and logs in through the API proxy when served over HTTP. The proxy keeps only a short-lived per-client cookie session; browser IndexedDB stores the local configuration and latest result cache. TrakCare may return HTTP 302 to the dashboard even for invalid credentials, so login must be verified by requesting the protected dashboard and detecting a subsequent redirect back to `/login`.

**Why:** The TrakCare endpoint redirects unauthenticated requests to a CSRF-protected login form, and the web app cannot reliably manage its HttpOnly session cookie from the browser.

**How to apply:** Never hardcode credentials, keep session cookies out of IndexedDB and logs, verify the protected dashboard after every login, retry login once after expiry, and retain direct browser fetch only for the offline launcher on the hospital network. In the offline browser path, follow cross-origin redirects instead of using manual redirect mode because Chrome can expose manual cross-origin 3xx responses as opaque status 0. The offline bundle needs a reachable server-side bridge for reliable TrakCare cookies; the Windows launcher starts the local PowerShell bridge, while the old Cloud-only proxy is for backup only.