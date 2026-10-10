// A mockup chain is the picture sequence of one Etsy listing: up to ten
// mockup scenes in listing order (the first is the thumbnail) and at most
// one video, a clip of one of the scenes. Rendered with whichever poster is
// being listed. One chain is the default the upload pipeline uses.
// Stored as the document "mockups/chains".

export const MAX_CHAIN_PHOTOS = 10

export type ChainVideo = { sceneId: string; clipId: string }

export type MockupChain = {
  id: string
  name: string
  /** Scene ids in listing order; photo 1 is the thumbnail. */
  scenes: string[]
  video: ChainVideo | null
  /** Exactly one chain is the default. */
  isDefault: boolean
  /** ISO 8601 */
  createdAt: string
  updatedAt: string
}

/** What can be changed on a chain. Setting `isDefault` makes it the default. */
export type ChainPatch = Partial<Pick<MockupChain, "name" | "scenes" | "video">> & { isDefault?: true }

/** "01.jpg" … — the photo's place in the listing. */
export const chainPhotoName = (index: number) => `${String(index + 1).padStart(2, "0")}.jpg`
