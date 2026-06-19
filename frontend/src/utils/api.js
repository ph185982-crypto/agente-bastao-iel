// Base URL of the backend API.
// In development Vite proxies /api → localhost:3001, so this stays empty.
// In production set VITE_API_URL to your Render backend URL.
export const API_BASE = import.meta.env.VITE_API_URL || '';

// Token for authenticated Brain API requests.
const BRAIN_TOKEN = import.meta.env.VITE_BRAIN_TOKEN || '';

/**
 * Wrapper around fetch that adds the Brain Authorization header.
 * Use this for all /api/brain/* calls.
 */
export function brainFetch(url, opts = {}) {
  const headers = { ...opts.headers };
  if (BRAIN_TOKEN) {
    headers['Authorization'] = `Bearer ${BRAIN_TOKEN}`;
  }
  return fetch(url, { ...opts, headers });
}
