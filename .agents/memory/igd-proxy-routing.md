---
name: IGD proxy routing
description: Access strategy for the IGD Ward TrakCare feed.
---

The IGD Ward page uses the `/api/trakcare/igd-ward` proxy route, which returns the complete IGD patient list. In a normal web app, the same-origin proxy should be preferred because direct browser access to the internal TrakCare host can fail with CORS or DNS errors. The generated `file://` bundle also uses the public proxy base injected during offline build. That injected public base is for Cloud Backup and IGD Ward only; it must never be treated as a KTM/TrakCare proxy.

**Why:** The API proxy can reach the source from the configured runtime even when a browser cannot read the internal response directly. Static/offline deployments need a CORS-enabled public proxy; direct access from the EMC network remains useful through the Windows launcher.

**How to apply:** Prefer the proxy whenever the app is served over HTTP(S) or when `file://` has an injected offline API base. Keep `hasTrakCareProxy()` false for the injected offline base, so Monitoring KTM uses `appsprn.emc.id` directly via the Windows launcher. Retain direct fetch only as a fallback for `file://` deployments opened with the internal-network launcher. Use an `AbortController` timer rather than `AbortSignal.timeout` in the standalone bundle for compatibility with older Chrome/Edge versions.