---
name: Preview routing
description: Duplicate root web artifacts can make the Replit preview return 502 or select the wrong app.
---

Keep exactly one web artifact on the root preview path `/`; move imported scaffolds or secondary web artifacts to a unique path before validating preview routing.

**Why:** The imported project temporarily had both a complete app and an empty scaffold registered at `/`, so the public preview could not resolve the root service reliably.

**How to apply:** After importing or creating artifacts, list registered artifacts and inspect every `previewPath` before restarting workflows or changing service ports. The primary admission app uses `/`; restart its web workflow after changing `BASE_PATH` so the running Vite process does not retain the old prefix.