---
name: Cloud backup UX
description: Background cloud backup should remain unobtrusive while manual actions retain clear completion feedback.
---

Automatic cloud backup must not open loading popups or interrupt the user; show progress only in a local status area when the user is already viewing backup controls. Manual backup may show success or failure after completion, while restore keeps an explicit blocking indicator because it changes local data.

**Why:** Large, staged uploads can take several seconds and a global loading toast makes routine background synchronization feel like an application interruption.

**How to apply:** Keep background backup silent, use inline button/card state for manual progress, and reserve global notifications for the final result or actionable errors.