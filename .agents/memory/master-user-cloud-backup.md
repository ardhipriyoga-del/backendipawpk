---
name: Master user cloud backup
description: User account changes must use the durable full-snapshot backup path so offline edits retry when connectivity returns.
---

Master User records are part of the complete Cloud snapshot and the GAS contract rejects backups without a non-empty `users` store. Add, edit, activation changes, deletion, and password changes must trigger the durable auto-backup path rather than a fire-and-forget upload.

**Why:** A direct background upload can fail silently while offline and leave account changes only in IndexedDB, preventing other devices from seeing new users or updated credentials.

**How to apply:** Use the auto-backup helper after every Master User mutation. It marks `pendingCloudSync` offline, flushes pending row changes, then uploads every IndexedDB store when online; keep the current-user and last-superuser safeguards intact. A startup restore must compare a local-change revision immediately before import so it cannot overwrite a user added during the restore request. Rebuild `public/ipaw.html` whenever the offline form changes.