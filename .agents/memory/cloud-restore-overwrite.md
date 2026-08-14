---
name: Cloud restore overwrite policy
description: Restore Cloud behavior when the browser has unsynced local changes.
---

Restore Cloud is an explicit destructive operation: after the user confirms, the validated Cloud snapshot is authoritative and unsynced local changes may be discarded. The restore must clear the local row-change outbox and pending full-backup marker after import so background sync cannot re-upload the discarded state.

**Why:** Blocking restore on `pendingCloudSync` made recovery impossible when the local queue was stale or could not upload, even though the Cloud snapshot was available. The UI confirmation already warns that local data will be overwritten.

**How to apply:** Keep network, response-format, user-master validation, and import failures as real errors. Do not reintroduce a pre-restore pending-change guard; surface the destructive consequence in every Restore Cloud confirmation.