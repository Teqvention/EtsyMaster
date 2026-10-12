import { importOrigins } from "@/lib/citys/artikel"
import { respond } from "@/lib/mockups/respond"

// Reads the old project's list of live listings by origin (its markdown, as
// the body) into citys/origins: robin or old for each listing it names.
export async function POST(request: Request) {
  const markdown = await request.text()
  if (!markdown.trim()) return Response.json({ error: "Send the document's text" }, { status: 400 })
  return respond(() => importOrigins(markdown, request.headers.get("x-file-name") ?? "upload"))
}
