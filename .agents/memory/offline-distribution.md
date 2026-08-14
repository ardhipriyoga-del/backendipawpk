---
name: Offline distribution
description: Constraints for producing the standalone IP Admission HTML download from Vite output.
---

The standalone HTML distribution must be generated from the current Vite output rather than hardcoded hashed filenames. Offline builds need dynamic imports inlined, and bundled CSS/JavaScript should be transported as Base64 decoded by a DOMContentLoaded bootstrap.

**Why:** Vite changes asset hashes between builds, a file opened directly from disk cannot resolve the normal asset graph reliably, and embedded library strings can contain `</script>`/`</style>` that prematurely terminate raw HTML blocks.

**How to apply:** Run the offline build mode, derive asset names from generated `index.html`, remove the final Vite entry `export` before classic-script evaluation, encode the single CSS/JS payload, decode after `DOMContentLoaded`, inject the current public API proxy URL for Cloud Backup, and validate that the generated HTML has no external asset tags or visible bundle source. Keep the generator path-independent and run it after every frontend build so both `public/` and `dist/public/` contain the current download.

**Why:** The normal Vite page loads JavaScript as an ES module, but the standalone `file://` page evaluates its Base64-decoded bundle as a classic script; leaving the entry export causes `Unexpected token 'export'` and a blank page.