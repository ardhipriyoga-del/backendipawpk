---
name: Startup resilience
description: The application startup boundary between local state and optional cloud services.
---

The application must initialize local IndexedDB defaults before starting Cloud restore, but login and existing-session resumption must wait for that restore to settle. When Cloud fails or is empty, explicitly fall back to local/offline login.

**Why:** Users must not edit a pre-restore local snapshot while Cloud data is being imported, but offline deployments still need a usable local fallback when Cloud cannot be reached.

**How to apply:** Render the login page with a clear pending state, disable login while restore is pending, use an abortable timeout, permit local login only after a failed/empty restore, and start background backup only after startup restore completes.