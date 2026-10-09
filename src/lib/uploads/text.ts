import { TAG_COUNT, TAG_MAX, TITLE_MAX } from "./types"

// Etsy's rules for titles and tags, and how much of a source listing's
// wording a new listing carries over. Shared by the copywriter (to repair
// what the model writes) and the page (to warn while editing).

const STOPWORDS = new Set([
  "a", "an", "and", "art", "the", "for", "with", "of", "in", "on", "to", "by", "your", "you", "our", "this", "that", "from", "or", "at", "as",
])

/** Lower case, single spaces, no characters Etsy rejects in tags. */
export function cleanTag(tag: string) {
  return tag
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' -]+/gu, " ")
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

/** Keeps the first `char` and replaces the rest: Etsy allows %, : and & once each. */
function once(text: string, char: string, instead: string) {
  let seen = false
  return text.replaceAll(char, () => (seen ? instead : ((seen = true), char)))
}

/**
 * A title Etsy accepts: one line, no doubled separators, %, : and & once
 * each, at most three words in capitals, ≤ 140 characters ending on a whole
 * phrase.
 */
export function cleanTitle(title: string) {
  let text = title
    .replace(/\s+/g, " ")
    .split("|")
    .map((phrase) => phrase.trim())
    .filter(Boolean)
    .join(" | ")
  text = once(once(once(text, "&", "and"), ":", ""), "%", "")
  let caps = 0
  text = text.replace(/\b[A-Z]{2,}\b/g, (word) =>
    ++caps > 3 ? word[0] + word.slice(1).toLowerCase() : word
  )
  text = text.replace(/\s+/g, " ").trim()
  if (text.length <= TITLE_MAX) return text
  const phrases = text.split(" | ")
  text = ""
  for (const phrase of phrases) {
    const next = text ? `${text} | ${phrase}` : phrase
    if (next.length > TITLE_MAX) break
    text = next
  }
  return text || fit(phrases[0], TITLE_MAX)
}

/** Content words, lightly singularised so "posters" meets "poster". */
export function words(text: string) {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
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
