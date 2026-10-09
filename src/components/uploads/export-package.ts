import type { MockupChain } from "@/lib/mockups/chain-types"
import type { Draft } from "@/lib/uploads/types"

// Everything one Etsy listing needs, as a zip: the listing photos and video
// from the draft's mockup chain ("01.jpg" …, "video.mp4"), the poster itself
// (the buyer's download) and listing.txt with the copy. Rendered in the
// browser, like every mockup export; the renderer only loads when asked.

export async function exportPackage(
  draft: Draft,
  chain: MockupChain | null,
  onProgress: (text: string) => void
) {
  const [{ zipSync }, { renderChain }, { decode }, { download, dropPoster }] = await Promise.all([
    import("fflate"),
    import("@/lib/mockups/chain-render"),
    import("@/lib/mockups/renderer"),
    import("@/lib/mockups/client"),
  ])

  onProgress("Loading poster")
  const response = await fetch(draft.poster)
  if (!response.ok) throw new Error(`Couldn't load the poster (${response.status})`)
  const posterBlob = await response.blob()
  const extension = draft.poster.split(".").pop()?.toLowerCase() || "png"

  const files: Record<string, Uint8Array> = {}
  if (chain) {
    const bitmap = await decode(posterBlob)
    try {
      for (const file of await renderChain(chain, bitmap, onProgress)) {
        files[file.name] = new Uint8Array(await file.blob.arrayBuffer())
      }
    } finally {
      dropPoster(bitmap)
      bitmap.close()
    }
  }
  files[`poster.${extension}`] = new Uint8Array(await posterBlob.arrayBuffer())
  files["listing.txt"] = new TextEncoder().encode(listingText(draft))

  onProgress("Zipping")
  const zip = zipSync(files, { level: 0 })
  download(new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${slug(draft.title ?? draft.id)}.zip`)
}

function listingText(draft: Draft) {
  return [
    "TITLE",
    draft.title ?? "",
    "",
    "TAGS",
    (draft.tags ?? []).join(", "),
    "",
    "DESCRIPTION",
    draft.description ?? "",
    "",
    "---",
    `Strategy: ${draft.strategy ?? "–"}`,
    `Inspired by: ${draft.source.title}`,
    draft.source.url,
    "",
  ].join("\n")
}

const slug = (text: string) =>
  text
    .split(" | ")[0]
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "listing"
