// Big uploads share this machine's line with everything else it sends, the
// database's queries above all. 13 Oct a big order's images going up (to
// Cloud Storage for its batch jobs) filled the line for minutes: pings took
// two seconds, the database went out of reach and the order stood still
// for hours. So big uploads go `AT_ONCE` at a time, and each one's slot
// rests afterwards in proportion to how long it took: uploads take at most
// about `SHARE` of the line's time, however fast the line is, and what else
// goes out gets through in between.

const AT_ONCE = 2
const SHARE = 0.7
/** Smaller ones (a job's list of requests, a thumbnail) go at once: they don't fill the line. */
const SMALL = 256 * 1024
/** A rest is never longer than this, should an upload have hung for minutes. */
const MAX_REST = 30_000

type Line = { active: number; waiting: (() => void)[] }
// On globalThis, so every route (and a dev reload) shares the one line.
const global = globalThis as typeof globalThis & { __uplink?: Line }
const line = (global.__uplink ??= { active: 0, waiting: [] })

function take() {
  if (line.active < AT_ONCE) {
    line.active++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => line.waiting.push(resolve))
}

/** The slot goes straight to whoever waits, so nobody slips in between. */
function give() {
  const next = line.waiting.shift()
  if (next) next()
  else line.active--
}

/** Runs `send`, an upload of `bytes`, when the line has room for it. */
export async function uplink<T>(bytes: number, send: () => Promise<T>): Promise<T> {
  if (bytes < SMALL) return send()
  await take()
  const started = Date.now()
  try {
    return await send()
  } finally {
    const rest = Math.min(MAX_REST, ((Date.now() - started) * (1 - SHARE)) / SHARE)
    setTimeout(give, rest)
  }
}

/** How the line stands, for a look from outside. */
export const uplinkState = () => ({ uploading: line.active, waiting: line.waiting.length })
