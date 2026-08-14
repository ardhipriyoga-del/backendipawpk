---
name: Operating theatre source isolation
description: Separation rule for planned-action and In Progress Operating Theatre data.
---

The planned-action list and the In Progress list are separate sources and states. If the planned-action source returns zero rows, the UI must show zero rows; it must never use the In Progress status-list response as a fallback.

**Why:** TrakCare can expose linked or discovered status-list URLs from the dashboard page, and treating any non-empty OT response as planned data makes In Progress patients appear in the wrong tab.

**How to apply:** Keep discovery filters and response parsing view-specific. Preserve empty live results in the planned cache, and filter any stale cache or response that explicitly carries an In Progress status before rendering planned patients. Only reconcile a patient into the completed-action history after a successful live planned snapshot; never reconcile from a failed request or cache fallback.