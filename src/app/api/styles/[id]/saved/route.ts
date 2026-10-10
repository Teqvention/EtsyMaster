import { respond } from "@/lib/mockups/respond"
import { addSavedListings, type SavedPoster } from "@/lib/styles/saved"

type Context = RouteContext<"/api/styles/[id]/saved">

// Adds the posters of saved listings to the end of the moodboard (JSON
// `{ listings: [{ listingId, title, image }] }`), taken out of their photos
// in the background. Answers at once with the style, counting them as
// `incoming` until they're on the board; the guide is read after.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { listings?: unknown }
  const listings = Array.isArray(body.listings) ? body.listings : []
  if (listings.length === 0 || !listings.every(isListing)) {
    return Response.json({ error: "Pick saved listings with a photo" }, { status: 400 })
  }
  return respond(() =>
    addSavedListings(
      id,
      listings.map(({ listingId, title, image }) => ({ listingId, title, image }))
    )
  )
}

function isListing(value: unknown): value is SavedPoster {
  const v = value as SavedPoster
  return !!v && Number.isInteger(v.listingId) && typeof v.title === "string" && typeof v.image === "string" && !!v.image
}
