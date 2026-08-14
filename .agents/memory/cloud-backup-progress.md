---
name: Cloud backup progress
description: Backup progress is a transient live status in the notification center, not notification history.
---

Cloud backup progress should be emitted as one live status stream with preparing, chunk upload, commit, success, and error stages. The notification center renders a single progress card and a subtle bell indicator without creating unread history entries.

**Why:** Large staged uploads need visible progress, but one notification per chunk would flood history and make the notification badge misleading.

**How to apply:** Keep progress transient and in-memory, update the same card for every chunk, auto-dismiss terminal status after a short period, and preserve silent background behavior outside the notification center.