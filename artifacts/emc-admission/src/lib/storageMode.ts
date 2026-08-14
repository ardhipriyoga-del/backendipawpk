/**
 * Storage policy for the standalone distributions.
 *
 * The regular web app and ipaw.html retain their existing behavior. ipawv2.html
 * injects this flag before the bundled application starts, making IndexedDB
 * the primary workspace and Cloud an optional backup destination.
 */
declare global {
  var __IPAW_LOCAL_FIRST__: boolean | undefined;
}

export function isLocalFirstMode(): boolean {
  if (typeof globalThis !== 'undefined' && globalThis.__IPAW_LOCAL_FIRST__ === true) {
    return true;
  }

  if (typeof window !== 'undefined') {
    try {
      return new URLSearchParams(window.location.search).get('storage') === 'local-first';
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Online web deployments and ipawv2.html ask staff to confirm a patient that
 * disappeared from the inpatient source before archiving it. The legacy
 * ipaw.html file keeps its historical immediate-archive behavior.
 */
export function shouldConfirmMissingInpatient(): boolean {
  if (isLocalFirstMode()) return true;
  return typeof window !== 'undefined' && window.location.protocol !== 'file:';
}
