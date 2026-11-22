/**
 * Safely sanitizes a return/redirect URL to prevent Open Redirect attacks.
 * Accepts only internal relative paths starting with a single '/' and rejects
 * protocol-relative ('//'), backslash ('/\'), or external URLs.
 *
 * This utility has ZERO Node.js-only dependencies and is completely safe
 * to use in both Server Components and Client Components.
 */
export function getSafeRedirectUrl(url: string | null | undefined, fallback: string = '/dashboard'): string {
  if (!url || typeof url !== 'string') return fallback;
  const trimmed = url.trim();

  // Reject empty or non-relative paths
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return fallback;
  }

  // Reject any control characters, javascript:, or data: URLs
  if (/[\u0000-\u001F\u007F-\u009F]/.test(trimmed) || /^\/[a-zA-Z0-9]+:/i.test(trimmed)) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, 'http://localhost');
    if (parsed.origin !== 'http://localhost' || !parsed.pathname.startsWith('/')) {
      return fallback;
    }
    return parsed.pathname + parsed.search;
  } catch {
    return fallback;
  }
}
