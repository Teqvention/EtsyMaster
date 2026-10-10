import { formatDate } from "@/lib/etsy/format"

import type { Grain, RangeKey } from "./types"

// Calendar days as YYYY-MM-DD in the server's local time, the same days the
// sync keys its daily snapshots by. Weeks start on Monday.

const DAY = 24 * 60 * 60 * 1000
const pad = (n: number) => String(n).padStart(2, "0")

export const toKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
export const dayOf = (ms: number) => toKey(new Date(ms))

export function fromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(key: string, days: number) {
  const date = fromKey(key)
  date.setDate(date.getDate() + days)
  return toKey(date)
}

export const daysBetween = (from: string, to: string) => Math.round((fromKey(to).getTime() - fromKey(from).getTime()) / DAY)

export const weekStart = (key: string) => addDays(key, -((fromKey(key).getDay() + 6) % 7))
export const monthStart = (key: string) => `${key.slice(0, 7)}-01`

export function addMonths(key: string, months: number) {
  const date = fromKey(key)
  return toKey(new Date(date.getFullYear(), date.getMonth() + months, 1))
}

/** The bucket a day falls in. */
export const bucketOf = (key: string, by: Grain) => (by === "day" ? key : by === "week" ? weekStart(key) : monthStart(key))

const short = (key: string) => formatDate(key)
const withYear = (key: string) => formatDate(key, { month: "short", day: "numeric", year: "numeric" })
const monthName = (key: string, year = true) =>
  formatDate(key, { month: "long", ...(year && { year: "numeric" }) })

/** "Oct 6 – 12", "Sep 29 – Oct 5". */
function span(from: string, to: string) {
  if (from.slice(0, 7) === to.slice(0, 7)) return `${short(from)} – ${Number(to.slice(8))}`
  return `${short(from)} – ${short(to)}`
}

export type Range = {
  from: string
  to: string
  by: Grain
  label: string
  /** The period before, cut to as many days as this one has had. */
  previous: { from: string; to: string; label: string } | null
}

/**
 * The days a range covers: the current week, month or year (and those
 * before it), the last 30 or 90 days (and the windows before), or all time
 * since `first`, the earliest day with data.
 */
export function resolveRange(key: RangeKey, offset: number, today: string, first: string | null, by?: Grain): Range {
  const back = Math.min(0, Math.trunc(offset))
  let from: string
  let to: string
  let label: string
  let before: { from: string; to: string; label: string } | null

  switch (key) {
    case "week": {
      from = addDays(weekStart(today), back * 7)
      to = addDays(from, 6)
      label = span(from, to)
      before = { from: addDays(from, -7), to: addDays(from, -1), label: "the week before" }
      break
    }
    case "month": {
      from = addMonths(monthStart(today), back)
      to = addDays(addMonths(from, 1), -1)
      label = monthName(from)
      const prev = addMonths(from, -1)
      before = { from: prev, to: addDays(from, -1), label: monthName(prev, false) }
      break
    }
    case "year": {
      from = `${Number(today.slice(0, 4)) + back}-01-01`
      to = `${from.slice(0, 4)}-12-31`
      label = from.slice(0, 4)
      const prev = String(Number(from.slice(0, 4)) - 1)
      before = { from: `${prev}-01-01`, to: `${prev}-12-31`, label: prev }
      break
    }
    case "30d":
    case "90d": {
      const length = key === "30d" ? 30 : 90
      to = addDays(today, back * length)
      from = addDays(to, -(length - 1))
      label = back === 0 ? `Last ${length} days` : span(from, to)
      before = { from: addDays(from, -length), to: addDays(from, -1), label: `the ${length} days before` }
      break
    }
    case "all": {
      from = first && first < today ? first : addDays(today, -29)
      to = today
      label = `Since ${withYear(from)}`
      before = null
    }
  }

  // A period still running compares with as many days of the one before.
  const had = daysBetween(from, today < to ? today : to)
  const previous =
    before && {
      from: before.from,
      to: today < to && addDays(before.from, had) < before.to ? addDays(before.from, had) : before.to,
      label: today < to ? `the same days of ${before.label}` : before.label,
    }

  const days = daysBetween(from, to) + 1
  return { from, to, by: by ?? (days <= 45 ? "day" : days <= 200 ? "week" : "month"), label, previous }
}
