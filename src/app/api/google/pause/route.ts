import { googlePause, setGooglePaused } from "@/lib/google/pause"
import { respond } from "@/lib/mockups/respond"

// Whether calls to Google are paused, on every server: `{ paused, at }`.
export async function GET() {
  return respond(googlePause)
}

// Pauses or resumes every call to Google (JSON `{ paused: boolean }`).
export async function POST(request: Request) {
  const { paused } = (await request.json().catch(() => ({}))) as { paused?: unknown }
  if (typeof paused !== "boolean") {
    return Response.json({ error: "Say whether Google is paused: { paused: true | false }" }, { status: 400 })
  }
  return respond(() => setGooglePaused(paused))
}
