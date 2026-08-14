import { useState, useEffect, useCallback } from 'react';

/** Ambil path bersih dari hash, misal "#/login" → "/login" */
const getHashPath = (): string => {
  const hash = window.location.hash;
  if (!hash || hash === '#' || hash === '#/') return '/';
  return '/' + hash.replace(/^#\/?/, '');
};

/** Navigasi ke path dalam hash */
const hashNavigate = (to: string, { replace = false }: { replace?: boolean } = {}) => {
  const normalized = to.startsWith('/') ? to : '/' + to;
  if (replace) {
    window.history.replaceState(null, '', '#' + normalized);
  } else {
    window.location.hash = normalized;
  }
  // dispatch hashchange agar subscriber bereaksi
  window.dispatchEvent(new HashChangeEvent('hashchange'));
};

/** Hook pengganti useHashLocation dari wouter — pakai React dari bundle utama */
export const useHashLocation = (): [string, typeof hashNavigate] => {
  const [path, setPath] = useState<string>(getHashPath);

  useEffect(() => {
    const onHash = () => setPath(getHashPath());
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);

  const navigate = useCallback(hashNavigate, []);

  return [path, navigate];
};
