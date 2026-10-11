import { readDoc, writeDoc } from "@/lib/db/documents"

// One switch that stops every call to Google (Vertex, Gemini, Cloud Storage)
// on every server: kept in the shared database, checked before each call is
// signed in (see auth() in mockups/gemini.ts). While it's on, the batch poller,
// the online lane, the outbox and the generation queue wait instead of failing;
// switching it off sets them going again (see generation/run.ts).

export const PAUSE_KEY = "google/pause"

export type GooglePause = { paused: boolean; at: string | null }

const OFF: GooglePause = { paused: false, at: null }

export function googlePause() {
  return readDoc<GooglePause>(PAUSE_KEY, OFF)
}

export async function googlePaused() {
  return (await googlePause()).paused
}

export async function setGooglePaused(paused: boolean): Promise<GooglePause> {
  const value = { paused, at: new Date().toISOString() }
  await writeDoc(PAUSE_KEY, value)
  return value
}

export class GooglePausedError extends Error {
  constructor() {
    super("Google is paused: nothing goes to Google until it's switched back on")
  }
}
