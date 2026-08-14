---
name: GAS TrakCare routing
description: Constraints and routing rules for TrakCare when IPAW v3 is hosted by Google Apps Script.
---

When IPAW v3 is served by Google Apps Script, browser requests to TrakCare should use the GAS read-only fetch endpoint so the browser does not depend on TrakCare CORS headers. The GAS endpoint must allowlist TrakCare hosts and return the original page body for the existing client parsers.

**Why:** The public server environment can reach `apps.emc.id`, while `appsprn.emc.id` is an internal/unresolvable host outside the hospital network. Google Apps Script's `UrlFetchApp` can still hang on the public `apps.emc.id` inpatient endpoint even when the Replit API server reaches it, so GAS-only TrakCare support may require an approved network gateway or another protected proxy.

**How to apply:** Keep GAS-hosted routing separate from local direct/proxy routing. Do not turn the endpoint into an open proxy, and do not log returned patient HTML or JSON payloads.