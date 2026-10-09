import { respond } from "@/lib/mockups/respond"
import { listSaved, removeSaved, saveListings } from "@/lib/saved/storage"
import type { SaveRequest } from "@/lib/saved/types"

// Every saved listing, newest first.
export async function GET() {
  return respond(listSaved)
}

// File listings into a folder (JSON `{ folder, listings }`), created if new;
// listings saved elsewhere move. Answers with the whole list.
export async function POST(request: Request) {
  const { folder, listings } = (await request.json().catch(() => ({}))) as {
    folder?: unknown
    listings?: unknown
  }
  if (typeof folder !== "string" || !folder.trim() || !Array.isArray(listings) || !listings.every(isSaveRequest)) {
    return Response.json({ error: "A folder and listings are required" }, { status: 400 })
  }
  return respond(() => saveListings(folder, listings))
}

// Take listings out of Saved (JSON `{ ids }`). Answers with the whole list.
export async function DELETE(request: Request) {
  const { ids } = (await request.json().catch(() => ({}))) as { ids?: unknown }
  if (!Array.isArray(ids) || !ids.every(Number.isInteger)) {
    return Response.json({ error: "Listing ids are required" }, { status: 400 })
  }
  return respond(() => removeSaved(ids))
}

function isSaveRequest(value: unknown): value is SaveRequest {
  const v = value as SaveRequest
  return (
    !!v &&
    Number.isInteger(v.listingId) &&
    typeof v.title === "string" &&
    typeof v.url === "string" &&
    typeof v.image === "string" &&
    typeof v.thumb === "string"
  )
}
