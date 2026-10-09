const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60],
  ["month", 30 * 24 * 60],
  ["week", 7 * 24 * 60],
  ["day", 24 * 60],
  ["hour", 60],
  ["minute", 1],
]
const formats = {
  narrow: new Intl.RelativeTimeFormat("en-US", { numeric: "auto", style: "narrow" }),
  long: new Intl.RelativeTimeFormat("en-US", { numeric: "auto", style: "long" }),
}

/** "5m ago" (narrow) or "5 minutes ago" (long); "just now" under a minute. */
export function timeAgo(iso: string, now = Date.now(), style: keyof typeof formats = "narrow") {
  const minutes = Math.max(0, (now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return "just now"
  const [unit, size] = UNITS.find(([, size]) => minutes >= size)!
  return formats[style].format(-Math.floor(minutes / size), unit)
}
