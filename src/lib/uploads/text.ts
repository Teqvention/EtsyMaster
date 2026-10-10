import { TAG_COUNT, TAG_MAX, TITLE_MAX } from "./types"

// Etsy's rules for titles and tags, and how much of a source listing's
// wording a new listing carries over. Shared by the copywriter (to repair
// what the model writes) and the page (to warn while editing). Our shops
// never write a hyphen or dash, in tags and titles neither.

const STOPWORDS = new Set([
  "a", "an", "and", "art", "the", "for", "with", "of", "in", "on", "to", "by", "your", "you", "our", "this", "that", "from", "or", "at", "as",
])

/** Every kind of hyphen and dash, the minus sign included. */
export const DASH = "-‐‑‒–—―−⁃﹘﹣－⸺⸻"

const dashes = new RegExp(`[${DASH}]`, "g")

/** Lower case, single spaces, no characters Etsy rejects in tags, no hyphens: "mid-century" → "mid century". */
export function cleanTag(tag: string) {
  return tag
    .toLowerCase()
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/(^|\s)'+|'+(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

/** Cut at a word boundary to at most `max` characters. */
function fit(text: string, max: number) {
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1)
  const space = cut.lastIndexOf(" ")
  return (space > max * 0.5 ? cut.slice(0, space) : text.slice(0, max)).trim()
}

/** Tags Etsy accepts: cleaned, ≤ 20 characters, no duplicates, at most 13. */
export function cleanTags(tags: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const tag = fit(cleanTag(raw), TAG_MAX)
    if (tag.length < 2 || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length === TAG_COUNT) break
  }
  return out
}

/** Keeps the first `char` and replaces the rest: Etsy allows %, :, & and + once each. */
function once(text: string, char: string, instead: string) {
  let seen = false
  return text.replaceAll(char, () => (seen ? instead : ((seen = true), char)))
}

/** What a title's keyword phrases are joined with: " | " when it has one, else ", ". */
const separatorOf = (title: string) => (title.includes("|") ? " | " : ", ")

/**
 * A title Etsy accepts: one line, only the characters Etsy takes, no dashes
 * (a spaced one becomes the title's separator, "Mid-Century" "Mid Century"),
 * no doubled separators, %, :, & and + once each, at most three words in
 * capitals, ≤ 140 characters ending on a whole phrase.
 */
export function cleanTitle(title: string) {
  const separator = separatorOf(title)
  let text = title
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{Nd}\p{P}\p{Sm}\p{Zs}™©®]/gu, "")
    .replace(new RegExp(`(\\d)\\s*[${DASH}]\\s*(\\d)`, "g"), "$1 to $2")
    .replace(new RegExp(`\\s+[${DASH}]+\\s+`, "g"), separator)
    .replace(dashes, " ")
  text = (separator === " | " ? text.split("|") : text.split(/,(?!\d)/))
    .map((phrase) => phrase.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(separator)
  text = once(once(once(once(text, "&", "and"), ":", ""), "%", ""), "+", "and")
  let caps = 0
  text = text.replace(/\b[A-Z]{2,}\b/g, (word) =>
    ++caps > 3 ? word[0] + word.slice(1).toLowerCase() : word
  )
  text = text.replace(/\s+/g, " ").replace(/\s+([,:])/g, "$1").trim()
  if (text.length <= TITLE_MAX) return text
  const phrases = text.split(separator)
  text = ""
  for (const phrase of phrases) {
    const next = text ? `${text}${separator}${phrase}` : phrase
    if (next.length > TITLE_MAX) break
    text = next
  }
  return text || fit(phrases[0], TITLE_MAX)
}

/** Content words, lightly singularised so "posters" meets "poster" and "pigs" "pig". */
export function words(text: string) {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
}

/**
 * How much of the source's wording the copy carries over, 0–1: half from the
 * tags (a tag counts when it's kept as is, or mostly by its words), half from
 * the title's words.
 */
export function adoption(source: { title: string; tags: string[] }, copy: { title: string; tags: string[] }) {
  const copyWords = new Set([...words(copy.title), ...copy.tags.flatMap(words)])
  const copyTags = new Set(copy.tags.map(cleanTag))

  const sourceTags = cleanTags(source.tags)
  const tagShare = sourceTags.length
    ? sourceTags.reduce((sum, tag) => {
        if (copyTags.has(tag)) return sum + 1
        const own = words(tag)
        return sum + (own.length ? own.filter((w) => copyWords.has(w)).length / own.length : 0) * 0.6
      }, 0) / sourceTags.length
    : null

  const titleWords = [...new Set(words(source.title))]
  const titleShare = titleWords.length
    ? titleWords.filter((w) => copyWords.has(w)).length / titleWords.length
    : null

  const parts = [tagShare, titleShare].filter((n): n is number => n !== null)
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0
}

/** Which of the copy's tags come from the source (as is, or by most of their words). */
export function keptFromSource(source: { title: string; tags: string[] }, tags: string[]) {
  const sourceTags = new Set(cleanTags(source.tags))
  const sourceWords = new Set([...words(source.title), ...source.tags.flatMap(words)])
  return new Set(
    tags.filter((tag) => {
      if (sourceTags.has(cleanTag(tag))) return true
      const own = words(tag)
      return own.length > 0 && own.filter((w) => sourceWords.has(w)).length / own.length >= 0.67
    })
  )
}
