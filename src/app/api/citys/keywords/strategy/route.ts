import { editStrategy, writeStrategy, type StrategyPatch } from "@/lib/citys/keywords"
import { respond } from "@/lib/mockups/respond"
import { listStyles } from "@/lib/styles/storage"

// The keyword strategy: Gemini writes it from the research (POST), or it's
// changed by hand (PATCH with the lists that change).
export async function POST() {
  return respond(async () => {
    const styles = (await listStyles()).filter((s) => s.kind === "city" && s.guide)
    return writeStrategy(styles.map((s) => ({ id: s.id, name: s.name, guide: s.guide?.summary ?? "" })))
  })
}

export async function PATCH(request: Request) {
  const patch = (await request.json().catch(() => null)) as StrategyPatch | null
  if (!patch || typeof patch !== "object") return Response.json({ error: "Nothing to change" }, { status: 400 })
  return respond(() => editStrategy(patch))
}
