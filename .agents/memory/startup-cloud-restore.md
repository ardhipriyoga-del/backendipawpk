---
name: Startup cloud restore
description: Restore Cloud at startup must finish before login, with an explicit offline fallback when Cloud is unavailable.
---

Run the full restore whenever the application opens, but treat it as background hydration. Local IndexedDB and the login form must become usable as soon as local initialization finishes; route screens render from the local replica while Cloud refreshes it in the background. The startup restore must use an abortable fetch timeout so a late response cannot overwrite local data after a newer local edit.

**Why:** The Cloud endpoint can be reachable yet slow, and duplicate root workflows or proxy reloads can abort browser requests. Blocking login or route rendering made the app feel frozen and reduced offline usability. Cloud-first credential verification remains separate from the large background data restore.

**How to apply:** Start restore after local initialization, use an abortable timeout long enough for the current backup size (large tariff snapshots may need about two minutes), render routes immediately from IndexedDB, show only a small non-blocking sync indicator, and revalidate any stored session after restore completes. Keep Cloud-first credential verification for online login, with local fallback only when Cloud is unavailable. Start background backup independently of the restore completion.