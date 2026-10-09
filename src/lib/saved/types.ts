// A listing filed into a folder from a shop's gallery: enough of it to show
// the poster, link back to Etsy and run generations, without the Etsy API.
// Folders are the mockup categories, so a folder's mockups land in the
// category of the same name.

export type SavedListing = {
  listingId: number
  folder: string
  title: string
  url: string
  /** Full-size listing photo. */
  image: string
  /** ~570 px wide, for the grid. */
  thumb: string
  color: string | null
  shop: string | null
  priceCents: number
  currency: string
  salesPerMonth: number
  /** The seller's tags, the strongest hint for our own listing's keywords. */
  tags?: string[]
  /** Every listing photo (full size), first is `image`: mockups can be stolen from any. */
  photos?: string[]
  /** ISO 8601 */
  savedAt: string
}

export type SaveRequest = Omit<SavedListing, "folder" | "savedAt">
