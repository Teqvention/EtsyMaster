import { NotFoundError } from "./storage"

// Runs a scene operation as a JSON Route Handler response: 404 for unknown
// scenes and files, 500 with the message otherwise.
export async function respond(run: () => Promise<unknown>) {
  try {
    const data = await run()
    return Response.json(data ?? { ok: true })
  } catch (error) {
    const status = error instanceof NotFoundError ? 404 : 500
    const message = error instanceof Error ? error.message : "Request failed"
    return Response.json({ error: message }, { status })
  }
}
