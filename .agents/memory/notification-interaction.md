---
name: Persistent notification interaction
description: Sound-backed alerts stay visible until a deliberate user interaction and stop audio on any popup interaction.
---

Sound-backed notifications must not auto-dismiss. Keep them visible until the user swipes, closes, or uses the action, and stop the active sound as soon as the popup is clicked.

**Why:** An alert that disappears while its sound continues is easy to miss in a clinical workflow, especially when the user is handling another task.

**How to apply:** Route alert popups through the shared persistent notification helper. Keep ordinary success/error toasts transient, and guard async sound startup so a dismissal cannot be followed by delayed playback.