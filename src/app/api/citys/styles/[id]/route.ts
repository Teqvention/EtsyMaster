import {
  adoptCandidate,
  applyAnswers,
  autoTestOf,
  candidateAsStyle,
  dropCandidate,
  duplicateStyle,
  interview,
  labRounds,
  newDirections,
  sizedRound,
  startAutoTest,
  startInterview,
  stopAutoTest,
  patchCityStyle,
  rateLabImage,
  restoreVersion,
  retryRound,
  setStyleKind,
  startRound,
  tryCandidates,
} from "@/lib/citys/styles"
import { LAB_BLOCKS, type LabBlock, type RefMode } from "@/lib/citys/studio-types"
import { respond } from "@/lib/mockups/respond"
import { getStyle } from "@/lib/styles/storage"

type Context = RouteContext<"/api/citys/styles/[id]">

// A city style with its lab rounds.
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params
  return respond(async () => {
    const style = await getStyle(id)
    // An autonomous test whose server stopped reads as stopped.
    const autotest = await autoTestOf(style)
    return { style: style.city ? { ...style, city: { ...style.city, autotest } } : style, rounds: await labRounds(id) }
  })
}

// Its groups (`tags`), how it uses reference photos (`modes`), draft or
// confirmed (`status`), how it's painted (`paint`), or the kind of style it is (`kind`).
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { tags?: unknown; modes?: unknown; status?: unknown; kind?: unknown; paint?: unknown }
  return respond(async () => {
    if (body.kind === "city" || body.kind === "normal") return setStyleKind(id, body.kind)
    return patchCityStyle(id, {
      ...(Array.isArray(body.tags) && { tags: body.tags.filter((t): t is string => typeof t === "string") }),
      ...(Array.isArray(body.modes) && { modes: body.modes as RefMode[] }),
      ...((body.status === "draft" || body.status === "confirmed") && { status: body.status }),
      ...((body.paint === "redraw" || body.paint === "series") && { paint: body.paint }),
    })
  })
}

type Body = {
  action?: string
  blocks?: unknown
  delivery?: unknown
  candidate?: unknown
  round?: unknown
  image?: unknown
  rating?: unknown
  answers?: unknown
  notes?: unknown
  suggestions?: unknown
  free?: unknown
  name?: unknown
  version?: unknown
  count?: unknown
  cities?: unknown
  main?: unknown
  groups?: unknown
  size?: unknown
  passes?: unknown
}

// The lab: `{ action }` says what to do.
//   round       { blocks, delivery, candidate?, size? }   a test round (size small or middle: two or three places from words)
//   rate        { round, image, rating }           thumbs up or down on a test poster
//   retry       { round }                          its failed test posters painted again
//   interview   { round? }                         questions and suggestions on a fresh round (painted first when there's none)
//   answers     { answers: { [questionId]: 1–5 }, notes? }   the guide's next version
//   candidates  { groups: [{ suggestions: [ids], free? }], delivery, size? }   one variant per group, all its changes at once
//   autotest    { size, passes }                   the lab paints, judges and rewrites the guide by itself
//   autotest-stop                                  stops it after what's being painted
//   directions  { count, cities: [{ name, set }], main, delivery }   new ideas: nearby styles on the same cities
//   adopt | drop | own   { candidate, name? }      a variant made the guide, dropped, or a style of its own
//   restore     { version }                        back to an earlier version
//   duplicate   { name? }                          a copy to work on
export async function POST(request: Request, { params }: Context) {
  const { id } = await params
  const body = ((await request.json().catch(() => ({}))) ?? {}) as Body
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const delivery = body.delivery === "batch" ? "batch" : "now"
  const size = body.size === "small" || body.size === "middle" ? body.size : undefined
  return respond(async () => {
    switch (body.action) {
      case "round": {
        const blocks = (Array.isArray(body.blocks) ? body.blocks : LAB_BLOCKS).filter((b): b is LabBlock => LAB_BLOCKS.includes(b as LabBlock))
        if (!blocks.length && !size) throw new Error("Pick at least one block")
        return startRound(id, { ...(size ? sizedRound(size) : { blocks }), delivery, ...(str(body.candidate) && { candidate: str(body.candidate) }) })
      }
      case "retry":
        await retryRound(str(body.round))
        return { ok: true }
      case "rate":
        await rateLabImage(str(body.round), str(body.image), body.rating === "up" || body.rating === "down" ? body.rating : null)
        return { ok: true }
      case "interview":
        return str(body.round) ? interview(id, str(body.round)) : startInterview(id)
      case "autotest":
        return startAutoTest(id, { size: size ?? "small", passes: Number(body.passes) || 3, delivery })
      case "autotest-stop":
        return stopAutoTest(id)
      case "answers": {
        const answers = Object.fromEntries(
          Object.entries((body.answers ?? {}) as Record<string, unknown>).filter(([, v]) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5)
        ) as Record<string, number>
        return applyAnswers(id, answers, str(body.notes))
      }
      case "candidates": {
        const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [])
        const groups = Array.isArray(body.groups)
          ? body.groups.map((g: { suggestions?: unknown; free?: unknown }) => ({ suggestions: strings(g?.suggestions), free: str(g?.free) }))
          : [{ suggestions: strings(body.suggestions), free: str(body.free) }]
        return tryCandidates(id, groups, delivery, size ?? "middle")
      }
      case "directions": {
        const cities = (Array.isArray(body.cities) ? body.cities : [])
          .filter((c): c is { name: string; set?: unknown } => !!c && typeof c.name === "string")
          .map((c) => ({ name: c.name, set: c.set === true }))
        return newDirections(id, { count: Number(body.count) || 3, cities, delivery, main: body.main !== false })
      }
      case "adopt":
        return adoptCandidate(id, str(body.candidate))
      case "drop":
        return dropCandidate(id, str(body.candidate))
      case "own": {
        const name = str(body.name).trim()
        if (!name) throw new Error("Name the new style")
        return candidateAsStyle(id, str(body.candidate), name)
      }
      case "restore":
        return restoreVersion(id, str(body.version))
      case "duplicate":
        return duplicateStyle(id, str(body.name).trim() || undefined)
      default:
        throw new Error("Unknown action")
    }
  })
}
