// A fixed locale keeps server- and client-rendered output identical.
const LOCALE = "en-US"

export function formatCurrency(
  cents: number,
  currency = "USD",
  options: Intl.NumberFormatOptions = {}
) {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    ...options,
  }).format(cents / 100)
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat(LOCALE).format(value)
}

export function formatPercent(fraction: number, signed = false) {
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(fraction)
}

export function formatDate(
  iso: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
) {
  return new Date(iso).toLocaleDateString(LOCALE, { timeZone: "UTC", ...options })
}

/** 1,284 → "1,284" · 12,940 → "12.9K" · 4,200,000 → "4.2M" */
export function formatCompact(value: number) {
  return new Intl.NumberFormat(LOCALE, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value < 10 ? 1 : value >= 10_000 ? 1 : 0,
  }).format(value)
}

/**
 * A per-month rate, where "0.03" and "0" mean different things: 0.03 → "<0.1".
 * `approx` prefixes estimates with "≈" (but not "<0.1", which already hedges).
 */
export function formatRate(value: number, approx = false) {
  if (value > 0 && value < 0.1) return "<0.1"
  return `${approx ? "≈ " : ""}${formatCompact(value)}`
}

export function formatCompactCurrency(cents: number, currency = "USD") {
  const value = cents / 100
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : value >= 100 ? 0 : 2,
  }).format(value)
}

/** Listing age as one short unit: "12d", "5mo", "3.2y". */
export function formatAge(days: number) {
  if (days < 60) return `${Math.max(1, Math.round(days))}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${(days / 365).toFixed(days < 3650 ? 1 : 0)}y`
}
