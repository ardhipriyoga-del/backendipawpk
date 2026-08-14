---
name: Preview root routing
description: Root preview must have exactly one web artifact owner.
---

Only one web artifact should own the `/` preview path. When importing an existing app into a workspace that already has a scaffolded root artifact, move the unused scaffold to a unique subpath before assigning `/` to the real app.

**Why:** Duplicate root registrations cause the preview proxy to show `404 Not Found` or route to the wrong application even when the frontend server itself is healthy.

**How to apply:** Check registered artifact preview paths before starting the app; keep the main product at `/`, use a distinct path for placeholders or alternate copies, and make workflow commands use absolute paths when the artifact runs from the workspace root.