const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

/**
 * Parse a server-origin timestamp string into a Date.
 * - ISO 8601 with T + Z or ±offset: parsed natively.
 * - Legacy SQLite "YYYY-MM-DD HH:MM:SS" (no T, no Z): treated as UTC.
 * - Empty or unparseable: returns new Date(NaN).
 */
export function parseServerTime(s: string): Date {
  if (!s) return new Date(NaN)
  if (ISO_RE.test(s)) return new Date(s)
  // Legacy "YYYY-MM-DD HH:MM:SS" — SQLite datetime('now') was UTC but untagged
  const normalized = s.replace(' ', 'T') + 'Z'
  return new Date(normalized)
}

const _fmt = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/**
 * Format an ISO 8601 string as HH:MM:SS in the viewer's local timezone.
 * Returns '—' for invalid input.
 */
export function formatStreamTime(iso: string): string {
  const d = parseServerTime(iso)
  if (isNaN(d.getTime())) return '—'
  return _fmt.format(d)
}
