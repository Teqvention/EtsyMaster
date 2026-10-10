import { EtsyApiError } from "@/lib/etsy/client"
import { NotFoundError } from "@/lib/mockups/storage"

/** A request Artikel can't do as asked: 400, or the status given (409 for a shop not connected). */
export class InputError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

// Runs an Artikel operation as a JSON Route Handler response: the status of
// an InputError, 404 for unknown things (null included), Etsy's status for
// its errors, 500 otherwise.
export async function respond(run: () => Promise<unknown>) {
  try {
    const data = await run()
    if (data === null) return Response.json({ error: "Not found" }, { status: 404 })
    return Response.json(data ?? { ok: true })
  } catch (error) {
    const status =
      error instanceof InputError
        ? error.status
        : error instanceof NotFoundError
          ? 404
          : error instanceof EtsyApiError
            ? error.status
            : 500
    const message = error instanceof Error ? error.message : "Request failed"
    return Response.json({ error: message }, { status })
  }
}
