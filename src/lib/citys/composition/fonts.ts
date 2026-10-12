import opentype, { type Font } from "opentype.js"

import { readDoc, updateDoc, writeDoc } from "@/lib/db/documents"
import { getFile, putFile } from "@/lib/storage/files"

import { fontKey, type Fonts } from "./render"
import type { TextElement } from "./model"

// Fonts for compositions: any Google Font, by family, weight and style. The
// font file is fetched from Google once (asked for without a browser's
// signature, Google answers with a whole TrueType file) and kept in our
// storage, so print files never depend on Google being there. The
// catalogue of families (with their weights and how popular they are) is
// read from Google's own metadata and kept a week; likes and lists of
// fonts are the shop's own.

const FILE = (family: string, weight: number, italic: boolean) =>
  `citys/fonts/${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${weight}${italic ? "i" : ""}.ttf`

const global = globalThis as typeof globalThis & { __cityFonts?: Map<string, Promise<Font>> }
const parsed = (global.__cityFonts ??= new Map())

/** The TrueType file of a font, fetched from Google the first time. */
export async function fontFile(family: string, weight: number, italic: boolean): Promise<Buffer> {
  const key = FILE(family, weight, italic)
  try {
    return await getFile(key)
  } catch {
    // Not kept yet.
  }
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@${italic ? 1 : 0},${weight}`, {
    signal: AbortSignal.timeout(20_000),
  })
  if (!css.ok) throw new Error(`Google Fonts has no ${family} ${weight}${italic ? " italic" : ""}`)
  const url = (await css.text()).match(/url\((https:[^)]+\.ttf)\)/)?.[1]
  if (!url) throw new Error(`No font file for ${family} ${weight}`)
  const file = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!file.ok) throw new Error(`Couldn't download ${family} (${file.status})`)
  const data = Buffer.from(await file.arrayBuffer())
  await putFile(key, data)
  return data
}

/** A font parsed, held in memory; the nearest weight the family has when that one's missing. */
export function loadFont(spec: TextElement["font"]): Promise<Font> {
  const key = fontKey(spec)
  let font = parsed.get(key)
  if (!font) {
    font = (async () => {
      const data = await fontFile(spec.family, spec.weight, spec.italic).catch(async (error) => {
        const weights = (await familyOf(spec.family))?.weights ?? []
        const nearest = weights.sort((a, b) => Math.abs(a - spec.weight) - Math.abs(b - spec.weight))[0]
        if (!nearest || nearest === spec.weight) throw error
        return fontFile(spec.family, nearest, false)
      })
      return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
    })()
    font.catch(() => parsed.delete(key))
    parsed.set(key, font)
  }
  return font
}

/** Every font of `specs`, by key; one that can't be had is left out (its text isn't drawn). */
export async function loadFonts(specs: TextElement["font"][]): Promise<Fonts> {
  const fonts: Fonts = new Map()
  await Promise.all(
    specs.map(async (spec) => {
      try {
        fonts.set(fontKey(spec), await loadFont(spec))
      } catch (error) {
        console.warn(`Font ${spec.family} ${spec.weight}:`, (error as Error).message)
      }
    })
  )
  return fonts
}

// --- The catalogue ---

export type FontFamily = { family: string; category: string; weights: number[]; italics: number[]; popularity: number }

type Catalog = { families: FontFamily[]; fetchedAt: string }

const CATALOG = "citys/fonts/catalog"
const WEEK = 7 * 24 * 60 * 60 * 1000

export async function fontCatalog(): Promise<FontFamily[]> {
  const held = await readDoc<Catalog | null>(CATALOG, null)
  if (held && Date.now() - Date.parse(held.fetchedAt) < WEEK) return held.families
  try {
    const response = await fetch("https://fonts.google.com/metadata/fonts", { signal: AbortSignal.timeout(30_000) })
    const text = (await response.text()).replace(/^\)\]\}'\s*/, "")
    const meta = JSON.parse(text) as { familyMetadataList?: { family: string; category: string; popularity: number; fonts: Record<string, unknown> }[] }
    const families: FontFamily[] = (meta.familyMetadataList ?? []).map((f) => {
      const styles = Object.keys(f.fonts ?? {})
      return {
        family: f.family,
        category: f.category,
        weights: [...new Set(styles.filter((s) => !s.endsWith("i")).map(Number))].filter(Number.isFinite).sort((a, b) => a - b),
        italics: [...new Set(styles.filter((s) => s.endsWith("i")).map((s) => Number(s.slice(0, -1))))].filter(Number.isFinite).sort((a, b) => a - b),
        popularity: f.popularity,
      }
    })
    if (families.length) await writeDoc(CATALOG, { families, fetchedAt: new Date().toISOString() } satisfies Catalog)
    return families.length ? families : (held?.families ?? [])
  } catch (error) {
    console.warn("Font catalogue:", (error as Error).message)
    return held?.families ?? []
  }
}

async function familyOf(name: string) {
  return (await fontCatalog()).find((f) => f.family.toLowerCase() === name.toLowerCase()) ?? null
}

// --- Likes and lists ---

export type FontLists = { liked: string[]; lists: { id: string; name: string; families: string[] }[] }

const LISTS = "citys/fonts/lists"

export function fontLists() {
  return readDoc<FontLists>(LISTS, { liked: [], lists: [] })
}

export function saveFontLists(next: FontLists) {
  const clean: FontLists = {
    liked: [...new Set((next.liked ?? []).filter((f) => typeof f === "string"))].slice(0, 300),
    lists: (next.lists ?? [])
      .filter((l) => l && typeof l.name === "string" && l.name.trim())
      .slice(0, 40)
      .map((l) => ({ id: typeof l.id === "string" ? l.id : `l-${Date.now().toString(36)}`, name: l.name.trim().slice(0, 40), families: [...new Set((l.families ?? []).filter((f) => typeof f === "string"))].slice(0, 200) })),
  }
  return updateDoc<FontLists>(LISTS, { liked: [], lists: [] }, () => clean)
}
