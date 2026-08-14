---
name: Billing notification cycles
description: Rules for recurring temporary billing notifications every two inpatient days.
---

Temporary billing notification state is cycle-based, not episode-global. When an active non-BPJS inpatient reaches a later even inpatient day after a sent cycle, the next cycle starts with estimate zero and “Belum Dikirim”.

**Why:** A sent estimate is valid for one two-day notification cycle; carrying it forward makes the next billing reminder look completed and reuses a stale amount.

**How to apply:** Persist the current even-day cycle on the notification record, infer a legacy cycle from `sentAt` where possible, reset only previously sent records when the cycle changes, refresh while the billing tab remains open, and back up mutations through the normal Cloud path.