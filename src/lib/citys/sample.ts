import { listSets, readSetFile } from "@/lib/generation/storage"

import { isCitySet } from "./generate"

// A city photo to try layouts with before a real one is picked: the newest
// approved city poster, else the newest one painted. Looked up once a
// minute at most.

let held: { at: number; ref: { set: string; file: string } | null } | null = null

export async function samplePhotoRef() {
  if (held && Date.now() - held.at < 60_000) return held.ref
  const sets = (await listSets()).filter((s) => isCitySet(s) && !s.city.lab)
  const outputs = sets.flatMap((s) => s.outputs.filter((o) => o.status === "done" && o.file && o.city?.kind !== "style").map((o) => ({ set: s.id, file: o.file!, approved: o.review === "approved", at: o.createdAt })))
  const pick = outputs.sort((a, b) => Number(b.approved) - Number(a.approved) || b.at.localeCompare(a.at))[0]
  held = { at: Date.now(), ref: pick ? { set: pick.set, file: pick.file } : null }
  return held.ref
}

export async function samplePhoto() {
  const ref = await samplePhotoRef()
  return ref ? readSetFile(ref.set, ref.file).catch(() => null) : null
}
