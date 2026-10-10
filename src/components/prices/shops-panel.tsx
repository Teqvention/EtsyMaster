"use client"

import Link from "next/link"
import { toast } from "sonner"

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { patchAccount, uploadAccounts, useAccounts } from "@/hooks/use-accounts"
import { refreshPrices } from "@/hooks/use-prices"
import type { PricesState } from "@/lib/pricing/types"

import { Em, Panel } from "./shared"

// Which profile each upload account's new listings get. Listings already
// live keep their prices until Artikel moves them.

export function ShopsPanel({ state }: { state: PricesState }) {
  const accounts = uploadAccounts(useAccounts())
  const items = state.profiles.map((p) => ({ value: p.id, label: p.name }))
  const without = accounts.filter((a) => !a.priceProfileId)

  async function assign(id: string, priceProfileId: string) {
    try {
      await patchAccount(id, { priceProfileId })
      await refreshPrices()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <Panel
      title="Shops"
      finding={
        accounts.length === 0 ? (
          <>
            No upload account yet. <Link href="/settings" className="underline underline-offset-4">Add one in Settings</Link>.
          </>
        ) : without.length ? (
          <>
            <Em>{without.map((a) => a.label).join(", ")}</Em> {without.length === 1 ? "has" : "have"} no profile: uploads
            wait until {without.length === 1 ? "it gets" : "they get"} one.
          </>
        ) : (
          "New listings get their shop's prices. Existing ones change only through Artikel."
        )
      }
    >
      <ul className="flex flex-col divide-y text-[13px]">
        {accounts.map((account) => (
          <li key={account.id} className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{account.label}</span>
              <span className="truncate text-xs text-muted-foreground">{account.shop?.name ?? "No shop connected yet"}</span>
            </div>
            <Select
              value={account.priceProfileId}
              onValueChange={(value) => value && assign(account.id, value)}
              items={items}
            >
              <SelectTrigger size="sm" className="min-w-28" aria-label={`Price profile of ${account.label}`}>
                <SelectValue placeholder="No profile" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
