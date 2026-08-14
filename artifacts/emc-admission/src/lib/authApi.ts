import { apiUrl, hasApiProxy } from './apiConfig';
import { getCloudApiUrl } from './cloudSync';

export interface BackendAuthUser {
  id: number;
  username: string;
  namaLengkap: string;
  role: 'superuser' | 'officer';
}

interface BackendResponse {
  success?: boolean;
  user?: BackendAuthUser;
  message?: string;
}

async function parseResponse(response: Response): Promise<BackendResponse> {
  try {
    return await response.json() as BackendResponse;
  } catch {
    return {};
  }
}

export async function loginWithBackend(
  username: string,
  password: string,
): Promise<{ response: Response; body: BackendResponse }> {
  const cloudUrl = await getCloudApiUrl();
  const url = `${apiUrl('/api/auth/login')}?url=${encodeURIComponent(cloudUrl)}`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { response, body: await parseResponse(response) };
}

export async function getBackendSession(): Promise<BackendAuthUser | null> {
  if (!hasApiProxy()) return null;
  const response = await fetch(apiUrl('/api/auth/me'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const body = await parseResponse(response);
  return body.success && body.user ? body.user : null;
}

export async function logoutFromBackend(): Promise<void> {
  if (!hasApiProxy()) return;
  await fetch(apiUrl('/api/auth/logout'), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
}