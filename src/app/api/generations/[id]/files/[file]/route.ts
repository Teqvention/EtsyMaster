import { readSetFile } from "@/lib/generation/storage"
import { NotFoundError } from "@/lib/mockups/storage"

type Context = RouteContext<"/api/generations/[id]/files/[file]">

// A generated image. Every result is written under a new name, so a file
// never changes and the browser may keep it.
export async function GET(_request: Request, { params }: Context) {
  const { id, file } = await params
  try {
    const data = await readSetFile(id, file)
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "image/jpeg",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    })
  } catch (error) {
    const missing = error instanceof NotFoundError || (error as NodeJS.ErrnoException).code === "ENOENT"
    return new Response(null, { status: missing ? 404 : 500 })
  }
}
