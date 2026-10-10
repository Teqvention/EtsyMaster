import { scanPhotos } from "@/lib/mockups/scan"

// Hundreds of photos: each looked at, then one AI look per room.
export const maxDuration = 300

// JSON `{ photos, stolen }` (Etsy photo URLs, best first; and those made into
// mockups before): answers newline-delimited JSON, `{ progress }` lines as it
// goes and `{ photos }` (see `ScannedPhoto`) or `{ error }` last.
export async function POST(request: Request) {
  const { photos, stolen } = (await request.json().catch(() => ({}))) as { photos?: unknown; stolen?: unknown }
  const urls = (list: unknown) =>
    Array.isArray(list) ? list.filter((u): u is string => typeof u === "string" && u.startsWith("https://")) : []
  if (!urls(photos).length) return Response.json({ error: "No photos to look at" }, { status: 400 })

  const encoder = new TextEncoder()
  // Left or reloaded: the scan stops (what it found so far is kept).
  const gone = new AbortController()
  const signal = AbortSignal.any([request.signal, gone.signal])
  const stream = new ReadableStream({
    async start(controller) {
      const line = (value: unknown) => {
        if (!signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
      }
      try {
        line({ photos: await scanPhotos(urls(photos), urls(stolen), (progress) => line({ progress }), signal) })
      } catch (error) {
        line({ error: error instanceof Error ? error.message : "Failed" })
      } finally {
        if (!signal.aborted) controller.close()
      }
    },
    cancel() {
      gone.abort()
    },
  })
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } })
}
