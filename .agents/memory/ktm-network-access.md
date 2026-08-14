---
name: KTM network access
description: Network constraint and fallback rule for the TrakCare KTM monitoring feed.
---

The KTM source is the internal TrakCare URL ending in `hospital/4?ward=`. A cloud-hosted API proxy may return a network fetch failure because it cannot resolve or reach the internal `appsprn.emc.id` host, even when the same URL works from a browser connected to the EMC network.

**Why:** The Replit cloud environment cannot be assumed to have DNS or network access to the hospital's internal TrakCare domain.

**How to apply:** Keep the API proxy for environments that can reach TrakCare, but always retain a browser direct-fetch fallback for users on the EMC network. Do not replace the source URL with a public or alternate endpoint merely because the cloud proxy returns 502.