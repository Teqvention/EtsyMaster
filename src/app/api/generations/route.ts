import { parseOptions } from "@/lib/generation/options"
import { enqueue } from "@/lib/generation/run"
import { createSet, listSets } from "@/lib/generation/storage"
import { DEFAULT_OPTIONS, type GenerationKind, type GenerationSource } from "@/lib/generation/types"
import { respond } from "@/lib/mockups/respond"

// Every generation set, newest first.
export async function GET() {
  return respond(listSets)
}

// Queue one set per source (JSON `{ kind, folder, sources, options? }`;
// poster sets make what `options` asks for, three variants low to high by
// default). Answers with the new sets straight away; they run in the background.
export async function POST(request: Request) {
  const { kind, folder, sources, options } = (await request.json().catch(() => ({}))) as {
    kind?: unknown
    folder?: unknown
    sources?: unknown
    options?: unknown
  }
  if (
    (kind !== "poster" && kind !== "mockup") ||
    typeof folder !== "string" ||
    !Array.isArray(sources) ||
    !sources.length ||
    !sources.every(isSource)
  ) {
    return Response.json({ error: "A kind, a folder and listing photos are required" }, { status: 400 })
  }
  const parsed = options === undefined ? DEFAULT_OPTIONS : parseOptions(options)
  if (!parsed) return Response.json({ error: "Ask for at least one image" }, { status: 400 })
  return respond(async () => {
    const sets = []
    for (const source of sources) {
      const set = await createSet(kind as GenerationKind, folder, clean(source), parsed)
      enqueue(set.id)
      sets.push(set)
    }
    return sets
  })
}

function isSource(value: unknown): value is GenerationSource {
  const v = value as GenerationSource
  return !!v && Number.isInteger(v.listingId) && typeof v.title === "string" && typeof v.image === "string"
}

function clean(v: GenerationSource): GenerationSource {
  return {
    listingId: v.listingId,
    title: v.title,
    image: v.image,
    url: typeof v.url === "string" ? v.url : "",
    shop: typeof v.shop === "string" ? v.shop : null,
    ...(Array.isArray(v.tags) && { tags: v.tags.filter((t) => typeof t === "string").slice(0, 13) }),
  }
}
