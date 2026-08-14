---
name: Billing rule engine
description: Durable constraints for the local billing validation rule engine.
---

Rules are stored locally in IndexedDB and must remain backward-compatible when the schema gains optional metadata. Migrations must never recreate the billing rule store because that can erase user-authored rules.

**Why:** Billing validation is expected to work offline, and local rules are operational data that must survive application upgrades.

**How to apply:** Add new rule fields as optional properties, keep legacy conditions readable, sort execution by ascending priority, and keep formula evaluation restricted to the supported billing variables rather than using eval.