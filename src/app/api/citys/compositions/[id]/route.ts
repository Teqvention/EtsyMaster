import { combine, remix, remixIdeas } from "@/lib/citys/composition/ai"
import { improveRebuild } from "@/lib/citys/composition/rebuild"
import type { CompositionData } from "@/lib/citys/composition/model"
import {
  adoptCandidate,
  candidateAsComposition,
  deleteComposition,
  dropCandidate,
  duplicateComposition,
  getComposition,
  renameComposition,
  markExample,
  restoreVersion,
  saveLayout,
} from "@/lib/citys/composition/store"
import { respond } from "@/lib/mockups/respond"

type Context = RouteContext<"/api/citys/compositions/[id]">

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(() => getComposition(id))
}

// The editor's save (`{ data, version? }`: a note keeps it as a version).
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { data?: CompositionData; version?: unknown } | null
  const data = body?.data
  if (!data || !Array.isArray(data.elements) || !(data.ratio > 0)) return Response.json({ error: "A layout is required" }, { status: 400 })
  return respond(() => saveLayout(id, { ratio: data.ratio, background: data.background, elements: data.elements, sizes: data.sizes ?? {} }, typeof body?.version === "string" ? body.version : undefined))
}

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params
  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown }
  if (typeof name !== "string") return Response.json({ error: "Name it" }, { status: 400 })
  return respond(() => renameComposition(id, name))
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(() => deleteComposition(id))
}

// `{ action }`: ideas (five remix ideas), remix `{ ideas, free, creativity }`,
// combine `{ styleId, count, creativity }`, adopt | drop | own `{ candidate, name? }`,
// restore `{ version }`, duplicate, improve `{ passes }` (more rounds of
// comparing with the image it was rebuilt from; 0 only compares), example
// `{ on }` (a good example of a best-selling layout).
export async function POST(request: Request, { params }: Context) {
  const { id } = await params
  const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === "string" ? v : "")
  return respond(async () => {
    switch (body.action) {
      case "ideas":
        return remixIdeas(id)
      case "remix":
        await remix(id, Array.isArray(body.ideas) ? body.ideas.filter((i): i is string => typeof i === "string") : [], s(body.free), Number(body.creativity) || 3)
        return getComposition(id)
      case "combine":
        await combine(id, { styleId: s(body.styleId) || undefined, count: Number(body.count) || 1, creativity: Number(body.creativity) || 3 })
        return getComposition(id)
      case "adopt":
        return adoptCandidate(id, s(body.candidate))
      case "drop":
        return dropCandidate(id, s(body.candidate))
      case "own":
        return candidateAsComposition(id, s(body.candidate), s(body.name) || "Composition")
      case "restore":
        return restoreVersion(id, s(body.version))
      case "duplicate":
        return duplicateComposition(id)
      case "improve":
        await improveRebuild(id, Math.max(0, Math.min(8, Math.round(Number(body.passes ?? 3)) || 0)))
        return getComposition(id)
      case "example":
        return markExample(id, body.on !== false)
      default:
        throw new Error("Unknown action")
    }
  })
}
