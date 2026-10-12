// Etsy listing photos kept short: every size of a photo shares one address
// but for the size, so a digest keeps "<path>/<image id>/<suffix>" and the
// sizes are put back together here. Addresses that don't fit the pattern
// are kept whole.

const PATTERN = /^https:\/\/i\.etsystatic\.com\/(\d+)\/r\/il\/([0-9a-f]+)\/(\d+)\/il_[^.]+\.\3_([0-9a-z]+)\.jpg$/i

/** The short form of a listing photo's address. */
export function shortPhoto(url: string) {
  const match = PATTERN.exec(url)
  return match ? `${match[1]}/${match[2]}/${match[3]}/${match[4]}` : url
}

export type PhotoSize = "170x135" | "340x270" | "570xN" | "794xN" | "fullxfull"

/** A listing photo's address at `size`, from its short form (or a whole address). */
export function photoUrl(short: string, size: PhotoSize = "570xN") {
  if (short.startsWith("https://")) {
    const match = PATTERN.exec(short)
    if (!match) return short
    short = `${match[1]}/${match[2]}/${match[3]}/${match[4]}`
  }
  const [shop, path, id, suffix] = short.split("/")
  return `https://i.etsystatic.com/${shop}/r/il/${path}/${id}/il_${size}.${id}_${suffix}.jpg`
}
