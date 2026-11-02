export function normalizeUrlForCompare(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || "/";
    const normalizedPath = pathname.endsWith("/") ? pathname : `${pathname}/`;
    // Redirect query strings may carry short-lived Access/session credentials.
    // Compare origin and path only so CI logs never expose those values.
    return `${parsed.protocol}//${parsed.host}${normalizedPath}`;
  } catch {
    return String(url).trim().split(/[?#]/, 1)[0];
  }
}
