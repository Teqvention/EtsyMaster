import { readFile } from "node:fs/promises"

import sharp from "sharp"

import { NotFoundError } from "@/lib/mockups/storage"

// Images for the browser. Files never change once written, so every answer
// may be cached for good; `?w=` asks for a smaller copy for grids and pickers.

const WIDTHS = [160, 320, 480, 960]

export async function serveImage(request: Request, locate: () => string) {
  try {
    const file = locate()
    const asked = Number(new URL(request.url).searchParams.get("w"))
    // Only a few sizes, so the cache doesn't fill with near-duplicates.
    const width = WIDTHS.find((w) => w >= asked)
    const data =
      asked && width
        ? await sharp(file)
            .resize(width, width * 2, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 82 })
            .toBuffer()
        : await readFile(file)
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": asked && width ? "image/jpeg" : contentType(file),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    })
  } catch (error) {
    const missing =
      error instanceof NotFoundError ||
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      /missing|does not exist/i.test((error as Error).message ?? "")
    return new Response(null, { status: missing ? 404 : 500 })
  }
}

function contentType(file: string) {
  if (file.endsWith(".png")) return "image/png"
  if (file.endsWith(".webp")) return "image/webp"
  return "image/jpeg"
}
