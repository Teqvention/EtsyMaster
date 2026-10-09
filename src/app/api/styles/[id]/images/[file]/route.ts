import { respond } from "@/lib/mockups/respond"
import { removeImage } from "@/lib/styles/storage"
import { scheduleReading } from "@/lib/styles/understand"

type Context = RouteContext<"/api/styles/[id]/images/[file]">

// Takes an image off the moodboard; the guide is read again shortly after.
export async function DELETE(_request: Request, { params }: Context) {
  const { id, file } = await params
  return respond(async () => {
    const style = await removeImage(id, file)
    await scheduleReading(id)
    return style
  })
}
