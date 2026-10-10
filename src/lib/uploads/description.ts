import type { Account } from "@/lib/accounts/types"
import { OFFERED_KEYS, SIZE_BY_KEY, SIZE_KEYS, type PrintSize, type SizeKey } from "@/lib/catalog/sizes"
import type { PriceProfile } from "@/lib/pricing/types"

import { DASH } from "./text"

// The listing description as it goes to Etsy: the draft's story (written per
// poster, in the source listing's vibe) followed by the shop's fixed blocks:
// the print, the sizes, shipping, what if something is wrong, how it's made,
// and the shop's signature. Built at upload time, because the blocks depend
// on the shop the poster lands in. Each block has a few wordings, picked per
// listing, so a shop's descriptions don't read like one template; they only
// say what's known: shipping and returns come from the shop's own profiles
// once Settings has read them. Never a hyphen or dash anywhere.

export type DescriptionInput = {
  /** The draft's description: the story part. */
  story: string
  account: Account
  profile: PriceProfile | null
  /** Portrait or landscape, for the size lines. */
  orientation: "ver" | "hor"
  /** The sizes the listing offers; when absent, the offered ones the profile prices (all of them without one). */
  sizes?: SizeKey[]
  /** Picks the wordings; the story when absent, so a listing keeps its own. */
  seed?: string
}

/** Header marks, one per shop. */
const MARKS = ["▪", "◆", "■", "●", "◇", "✦"]

const NUMBERS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"]

/** FNV-1a: the same text always picks the same wordings. */
function hash(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** One of `options`, by the seed and the block, so the blocks don't all pick alike. */
function pick<T>(options: readonly T[], seed: string, block: string) {
  return options[hash(`${block}:${seed}`) % options.length]
}

const inches = (mm: number) => Math.round((mm / 25.4) * 10) / 10

/** "21 x 29.7 cm (A4, 8.3 x 11.7 in)"; landscape the other way round. */
function sizeLine(size: PrintSize, orientation: DescriptionInput["orientation"]) {
  const turn = (pair: (string | number)[]) => (orientation === "hor" ? [...pair].reverse() : pair)
  const [w, h] = turn([size.widthMm / 10, size.heightMm / 10])
  const paper = size.key.startsWith("a") ? size.key.toUpperCase() : null
  // A sizes by their exact inches; the others are sold by their inch name.
  const named = size.inches?.replace(/ in$/, "").split(" x ")
  const [iw, ih] = turn(paper || !named ? [inches(size.widthMm), inches(size.heightMm)] : named)
  return `${w} x ${h} cm (${[paper, `${iw} x ${ih} in`].filter(Boolean).join(", ")})`
}

function sizesOf({ sizes, profile }: DescriptionInput) {
  const offered = sizes ?? (profile ? OFFERED_KEYS.filter((k) => profile.prices[k] > 0) : OFFERED_KEYS)
  return SIZE_KEYS.filter((k) => offered.includes(k)).map((k) => SIZE_BY_KEY[k])
}

/** "1–3 business days" → "1 to 3 working days"; null when the label holds no time. */
function processing(label: string | undefined) {
  const match = label?.match(/(\d+)(?:\s*(?:to|[^\d\s\w]+)\s*(\d+))?\s*(business days?|working days?|days?|weeks?)/i)
  if (!match) return null
  const [, from, to, unit] = match
  const plural = (to && to !== from) || from !== "1"
  const word = /week/i.test(unit) ? (plural ? "weeks" : "week") : plural ? "working days" : "working day"
  return to && to !== from ? `${from} to ${to} ${word}` : `${from} ${word}`
}

/** What the shop's selected profiles say, where Settings has read them. */
function shopFacts({ options, listing }: Account) {
  return {
    shipping: options?.shippingProfiles.find((p) => p.id === listing.shippingProfileId),
    returns: options?.returnPolicies.find((p) => p.id === listing.returnPolicyId),
    printing: processing(options?.readinessStates.find((r) => r.id === listing.readinessStateId)?.label),
  }
}

type Block = { head: string; body: string }

function printBlock(seed: string): Block {
  return {
    head: pick(["THE PRINT", "PAPER", "PRINT AND PAPER"], seed, "print head"),
    body: pick(
      [
        "Printed on 200 gsm (80 lb) uncoated matte poster paper. No gloss, so no glare and no fingerprints, and the colors look the same from every angle. Colors may vary slightly depending on your screen.",
        "A matte poster on 200 gsm (80 lb) uncoated paper. It doesn't reflect light, so it still reads well opposite a window. Screens show colors a little differently, so expect small shifts.",
        "200 gsm (80 lb) paper without any coating, printed in full color. There is no shine on it, which keeps glare and fingerprints off. Colors can look slightly different on your screen.",
      ],
      seed,
      "print"
    ),
  }
}

function sizesBlock(input: DescriptionInput, seed: string): Block {
  const sizes = sizesOf(input)
  const count = NUMBERS[sizes.length] ?? String(sizes.length)
  const noun = sizes.length === 1 ? "size" : "sizes"
  const head = pick(["SIZES", "SIZES AND FRAMES", `${count} ${noun}`.toUpperCase()], seed, "sizes head")
  // A header that counts them already: the line under it doesn't again.
  const intro = head.startsWith(count.toUpperCase())
    ? pick(["Measured on the paper:", "The measurements are those of the paper:"], seed, "sizes intro")
    : pick(
        [
          `${count} ${noun}, measured on the paper:`,
          `${count} ${noun} to choose from, given as the size of the paper:`,
          `Choose from ${count.toLowerCase()} ${noun}. The measurements are those of the paper:`,
        ],
        seed,
        "sizes intro"
      )
  const frame = pick(
    [
      "All are common frame sizes, so a ready made frame fits. The frame is not included; the photos only show how the print can look.",
      "The frame in the photos is not part of the order. Every size is a standard one, so a frame from any shop will fit.",
      "Frames are not included. Since the sizes are standard, you will find one that fits almost anywhere.",
    ],
    seed,
    "frame"
  )
  return { head, body: [intro, ...sizes.map((s) => sizeLine(s, input.orientation)), "", frame].join("\n") }
}

function shippingBlock(account: Account, seed: string): Block {
  const { shipping, printing } = shopFacts(account)
  const free = shipping?.free === true
  const made = pick(
    [
      "Each print is made to order by my production partner, at a print shop close to you.",
      "Every poster is printed to order by my production partner, close to where it's going.",
      "Nothing waits in a warehouse: your print is made when you order it, by my production partner near you.",
    ],
    seed,
    "made to order"
  )
  const time = `Printing takes ${printing ?? "a few working days"}`
  const days = shipping?.minDays && shipping.maxDays && shipping.maxDays <= 14 ? shipping : null
  const delivery = days
    ? `${time}, delivery usually ${days.minDays === days.maxDays ? days.maxDays : `${days.minDays} to ${days.maxDays}`} days after that.`
    : `${time}; Etsy shows the delivery estimate for your address at checkout.`
  return {
    head: free
      ? pick(["FREE SHIPPING", "SHIPPING, FREE", "MADE TO ORDER, SHIPPED FREE"], seed, "shipping head")
      : pick(["SHIPPING", "MADE TO ORDER", "PRINTING AND SHIPPING"], seed, "shipping head"),
    body: [made, delivery, free ? "Shipping is free." : null].filter(Boolean).join(" "),
  }
}

function problemsBlock(account: Account, seed: string): Block {
  const { returns } = shopFacts(account)
  const replace = pick(
    [
      "Send me a photo of the print and the packaging. You get a free replacement and don't have to send anything back.",
      "If the print arrives creased, torn or misprinted, a photo is all I need. A new one goes out for free, and nothing has to go back.",
      "A photo of the damage is enough: I'll have a replacement printed and sent at no cost, with nothing to return.",
    ],
    seed,
    "problems"
  )
  const within = returns?.deadline ? ` within ${returns.deadline} days of delivery` : ""
  const policy = !returns
    ? null
    : returns.acceptsReturns
      ? `Returns are accepted${within}.`
      : returns.acceptsExchanges
        ? `Exchanges are possible${within}.`
        : "As every print is made for you, other returns aren't possible."
  return {
    head: pick(["IF SOMETHING IS WRONG", "IF IT ARRIVES DAMAGED", "DAMAGE OR MISPRINT"], seed, "problems head"),
    body: [replace, policy].filter(Boolean).join(" "),
  }
}

function madeBlock(seed: string): Block {
  return {
    head: pick(["HOW THIS IS MADE", "HOW IT'S MADE", "ABOUT THE ARTWORK"], seed, "made head"),
    body: pick(
      [
        "The image was created with an AI image model, directed and selected by me, then prepared for print.",
        "I make these with an AI image model: I direct it, pick the one version worth printing and prepare the file for print.",
        "Made with the help of an AI image model. Directing it, choosing the result and preparing it for print is my part.",
      ],
      seed,
      "made"
    ),
  }
}

export function buildDescription(input: DescriptionInput): string {
  const { story, account } = input
  const seed = input.seed ?? story
  const mark = MARKS[hash(account.id) % MARKS.length]
  const blocks = [
    printBlock(seed),
    sizesBlock(input, seed),
    shippingBlock(account, seed),
    problemsBlock(account, seed),
    madeBlock(seed),
  ]
  return withoutDashes(
    [story.trim(), ...blocks.map((b) => `${mark} ${b.head}\n${b.body}`), account.signature?.trim()]
      .filter(Boolean)
      .join("\n\n")
  )
}

const dash = `[${DASH}]`

/**
 * Every hyphen and dash out: "1–3" → "1 to 3", " — " and "word—word" →
 * ", ", "hand-drawn" → "hand drawn", a dash opening a line goes; what that
 * leaves (", ,", " .") is tidied.
 */
export function withoutDashes(text: string) {
  return text
    .replace(new RegExp(`(\\d)[ \\t]*${dash}[ \\t]*(\\d)`, "g"), "$1 to $2")
    .replace(new RegExp(`^[ \\t]*${dash}+[ \\t]*`, "gm"), "")
    .replace(new RegExp(`[ \\t]+${dash}+[ \\t]+|(?<=\\p{L})[–—―⸺⸻]+(?=\\p{L})`, "gu"), ", ")
    .replace(new RegExp(`${dash}+`, "g"), " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?:[ \t]*[,;:])+/g, "$1")
    .replace(/,(?=[.!?])/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
}
