---
name: User deletion safeguards
description: Safety rules for destructive Master User operations.
---

Deleting a Master User must require an explicit confirmation and the current superuser's password, must never delete the account currently in use, and must preserve at least one superuser.

**Why:** A destructive account change needs re-authentication; removing the active account can invalidate the current session, while removing the last superuser can leave the application without an administrator.

**How to apply:** Keep the guardrails in the UI and repeat them immediately before the IndexedDB deletion; synchronize the resulting user list after a successful deletion and record the action in the audit trail.