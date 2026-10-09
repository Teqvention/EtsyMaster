import { dropPoster, testPoster } from "./client"
import { decode } from "./renderer"

// The design shown in every mockup. Kept for the whole browser session so
// switching between the list and the editors doesn't ask for it again.

export type Poster = { name: string; bitmap: ImageBitmap; test: boolean }

let current: Poster | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function set(poster: Poster) {
  const old = current
  current = poster
  listeners.forEach((l) => l())
  if (old) {
    dropPoster(old.bitmap)
    old.bitmap.close()
  }
}

export function subscribePoster(listener: () => void) {
  listeners.add(listener)
  if (!current && !loading) {
    loading = testPoster().then((bitmap) => {
      if (!current) set({ name: "Test poster", bitmap, test: true })
    })
  }
  return () => listeners.delete(listener)
}

export const getPoster = () => current

export async function choosePoster(file: File) {
  set({ name: file.name, bitmap: await decode(file), test: false })
}

export async function resetPoster() {
  set({ name: "Test poster", bitmap: await testPoster(), test: true })
}
