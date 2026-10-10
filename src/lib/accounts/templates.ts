import { GelatoError } from "@/lib/gelato/client"
import { checkTemplate } from "@/lib/gelato/template"

import { getAccount, patchAccount, withChecks } from "./store"
import type { Account, TemplateStatus } from "./types"

// An upload account's Gelato templates, checked against the offered sizes when
// they're set and on demand. The result is kept on the account: a template
// that fails its check holds back live uploads (see readiness in store.ts)
// instead of failing every listing made from it.

type Slot = "templateId" | "templateIdLandscape"

const SLOTS: { slot: Slot; orientation: "ver" | "hor"; name: string }[] = [
  { slot: "templateId", orientation: "ver", name: "portrait" },
  { slot: "templateIdLandscape", orientation: "hor", name: "landscape" },
]

async function check(storeId: string, templateId: string, orientation: "ver" | "hor", name: string): Promise<TemplateStatus> {
  const checkedAt = new Date().toISOString()
  try {
    const result = await checkTemplate(storeId, templateId)
    const problems = [...result.problems]
    // A template in the wrong slot would print every poster sideways.
    if (result.orientation && result.orientation !== "mixed" && result.orientation !== orientation) {
      problems.unshift(`This is a ${result.orientation === "ver" ? "portrait" : "landscape"} template, not ${name}`)
    }
    return {
      ok: problems.length === 0,
      name: result.name,
      orientation: result.orientation,
      missing: result.missing,
      problems,
      checkedAt,
    }
  } catch (error) {
    const unknown =
      error instanceof GelatoError && (error.status === 404 || error.status === 400) && !/no saved gelato key/i.test(error.message)
    return {
      ok: false,
      name: "",
      orientation: null,
      missing: [],
      problems: [unknown ? "Gelato knows no template with this ID in the store's account" : (error as Error).message],
      checkedAt,
    }
  }
}

/** Checks the account's templates (only those in `slots`, or all) with Gelato and keeps the results. */
export async function checkAccountTemplates(id: string, slots: Slot[] = ["templateId", "templateIdLandscape"]) {
  const account = await getAccount(id)
  const gelato = account.gelato
  if (!gelato?.storeId) return account
  const results = await Promise.all(
    SLOTS.filter(({ slot }) => slots.includes(slot) && gelato[slot]).map(
      async ({ slot, orientation, name }) => [gelato[slot]!, await check(gelato.storeId, gelato[slot]!, orientation, name)] as const
    )
  )
  if (!results.length) return account
  return patchAccount(id, (a): Account => {
    // The store or a template may have changed meanwhile: keep only what still applies.
    if (!a.gelato || a.gelato.storeId !== gelato.storeId) return a
    return { ...a, gelato: withChecks(a.gelato, { ...a.gelato.checks, ...Object.fromEntries(results) }) }
  })
}
