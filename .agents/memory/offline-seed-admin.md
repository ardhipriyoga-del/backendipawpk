---
name: Offline seed admin
description: Initial admin credentials and Cloud restore behavior for fresh standalone browser installations.
---

Fresh standalone installations must create the initial `admin` account locally and store only its password hash in IndexedDB. A first Cloud restore must not replace that seed account with a different admin hash before the user can log in.

**Why:** The downloaded app initializes its local database before the background Cloud restore. Replacing the seed account during that restore made the documented initial login fail even though the local seeder had run.

**How to apply:** Keep the seed username and hash centralized in the auth module, repair a missing, stale, or inactive `admin` record before the normal login lookup when the seed credential is supplied, preserve the seed admin during first Cloud restore, and allow normal Cloud user restoration after the admin password has been changed.