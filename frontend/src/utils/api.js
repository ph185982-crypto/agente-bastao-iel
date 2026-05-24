// Base URL of the backend API.
// In development Vite proxies /api → localhost:3001, so this stays empty.
// In production set VITE_API_URL to your Render backend URL.
export const API_BASE = import.meta.env.VITE_API_URL || '';
