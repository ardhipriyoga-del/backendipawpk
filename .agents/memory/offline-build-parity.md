---
name: Offline build parity
description: The downloaded standalone HTML must be regenerated from the same production bundle as the online app.
---

The offline distribution is generated during the frontend production build and must remain a single self-contained HTML file; updating online features without rebuilding this file creates two different products.

**Why:** Users expect `ipaw.html` downloaded from the application to contain the same routes and behavior as the online version, while `file://` cannot resolve normal module and stylesheet asset URLs.

**How to apply:** Run the admission frontend production build after feature changes, verify the generated `public/ipaw.html` and `dist/public/ipaw.html` are identical, and confirm the bundle has no external script or stylesheet references.