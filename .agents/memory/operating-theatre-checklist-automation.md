---
name: Operating Theatre checklist automation
description: Automatic OT-to-checklist flow and next-day billing reminder behavior.
---

A planned Operating Theatre action that uniquely matches an active inpatient by the shared identity resolver creates or updates that episode's checklist. The action date is stored with an operating-theatre source marker, and Billing Tindakan becomes due on the following calendar day. A completed billing answer suppresses the reminder; a changed OT date resets that answer.

**Why:** Rencana Tindakan is a centralized operational source and should not require duplicate manual entry, while billing review must happen after the action date and remain episode-specific.

**How to apply:** Run synchronization from both the global monitor and the OT page refresh. Never create a checklist from an ambiguous or name-only match, and never remove an existing plan merely because a later OT poll is empty.