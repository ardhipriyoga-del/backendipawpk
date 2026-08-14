---
name: Checklist reminder navigation
description: Reminder checklist must preserve the intended patient filter across hash-route navigation.
---

Reminder actions that open Checklist Pasien must carry the requested filter through an application intent, rather than relying on a query string.

**Why:** The app uses hash-based routing, so query parameters embedded in the hash route are not consistently available through the browser search location and may prevent the route from matching as expected.

**How to apply:** Store a short-lived session intent, dispatch an in-app event for an already-mounted checklist page, consume it on checklist mount, and apply the corresponding active-list filter.