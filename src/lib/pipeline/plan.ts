import type { Distribution, PlanGroup } from "./types"

// Who gets which poster, and in which order the listings go up. Pure, so the
// Upload dialog's preview and the job agree on it.

export type Assignment = { groupId: string; outputId: string; account: string }

/**
 * Every poster of every group with its account. Fixed groups (one account,
 * or picked per poster) come first; split groups then fill up whichever of
 * their accounts has the fewest so far, taking turns on ties. So totals stay
 * even across groups and siblings of a group land in different shops.
 */
export function distribute(groups: PlanGroup[]): Assignment[] {
  const counts = new Map<string, number>()
  const add = (account: string) => counts.set(account, (counts.get(account) ?? 0) + 1)
  const assigned = new Map<string, Assignment[]>()

  const fixed = groups.filter((g) => g.distribution.mode !== "split")
  for (const group of fixed) {
    const list = group.outputs.map((outputId) => {
      const account = fixedAccount(group.distribution, outputId)
      add(account)
      return { groupId: group.groupId, outputId, account }
    })
    assigned.set(group.groupId, list)
  }

  for (const group of groups) {
    if (group.distribution.mode !== "split") continue
    const accounts = group.distribution.accounts
    let turn = 0
    const list = group.outputs.map((outputId) => {
      // The emptiest account; on a tie, the next one in turn after the last pick.
      let best = -1
      for (let k = 0; k < accounts.length; k++) {
        const i = (turn + k) % accounts.length
        if (best === -1 || (counts.get(accounts[i]) ?? 0) < (counts.get(accounts[best]) ?? 0)) best = i
      }
      turn = best + 1
      add(accounts[best])
      return { groupId: group.groupId, outputId, account: accounts[best] }
    })
    assigned.set(group.groupId, list)
  }

  // Back in the plan's group order.
  return groups.flatMap((g) => assigned.get(g.groupId) ?? [])
}

function fixedAccount(distribution: Distribution, outputId: string) {
  if (distribution.mode === "account") return distribution.account
  if (distribution.mode === "each") {
    const account = distribution.accounts[outputId]
    if (!account) throw new Error(`No account picked for poster ${outputId}`)
    return account
  }
  throw new Error("Split groups have no fixed account")
}

/**
 * Lists merged so each one is spread evenly over the result: every entry sits
 * at its share of its own list ((i + ½) / n), the smaller list first on a tie.
 * Three groups of 4, 2 and 2 come out A B C A A B C A, never a run of one.
 */
export function spread<T>(lists: T[][]): T[] {
  return lists
    .flatMap((list, g) => list.map((value, i) => ({ value, at: (i + 0.5) / list.length, n: list.length, g })))
    .sort((a, b) => a.at - b.at || a.n - b.n || a.g - b.g)
    .map((e) => e.value)
}

/**
 * Upload order: per account its groups interleaved, then the accounts
 * interleaved, so no shop gets a run of one motif and every shop starts at once.
 */
export function uploadOrder(assignments: Assignment[]): Assignment[] {
  const byAccount = new Map<string, Map<string, Assignment[]>>()
  for (const a of assignments) {
    const groups = byAccount.get(a.account) ?? new Map<string, Assignment[]>()
    byAccount.set(a.account, groups)
    groups.set(a.groupId, [...(groups.get(a.groupId) ?? []), a])
  }
  return spread([...byAccount.values()].map((groups) => spread([...groups.values()])))
}
