---
name: API bundle rebuild
description: API route source can be complete while a running service still serves an older bundle.
---

When API routes return 404 despite existing in source, rebuild the API artifact before changing frontend URLs; the managed API workflow rebuilds the bundle on restart.

**Why:** The running server was serving a stale bundle containing only the health route, while cloud, KTM, and TrakCare routes were already present in source.

**How to apply:** Verify route markers in `dist/index.mjs`, restart the managed API workflow, then test through the shared `/api` proxy.