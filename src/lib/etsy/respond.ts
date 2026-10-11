import { EtsyApiError } from "./client"

// Turns a data loader into a JSON Route Handler response, passing Etsy's
// status through (404 for a removed listing, 429 when over quota, ...).
export async function respond(load: () => Promise<unknown>) {
  try {
    const data = await load()
    if (data === null) return Response.json({ error: "Not found" }, { status: 404 })
    return Response.json(data)
  } catch (error) {
    const status = error instanceof EtsyApiError ? error.status : 500
    const message = error instanceof Error ? error.message : "Request failed"
    return Response.json({ error: message }, { status })
  }
}

/**
 * The accounts a public read is to use (`?accounts=acc1,acc2`), sorted so the
 * cache key holds still; undefined leaves it to the analysis accounts.
 */
export function poolParam(search: URLSearchParams) {
  const ids = (search.get("accounts") ?? "").split(",").filter((id) => /^[\w-]{1,40}$/.test(id))
  return ids.length ? [...new Set(ids)].sort() : undefined
}
