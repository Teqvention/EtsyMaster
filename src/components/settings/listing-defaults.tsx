"use client"

import * as React from "react"
import { ChevronDownIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Choice, Row, Rows, SavedInput, saveAccount } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Switch } from "@/components/ui/switch"
import { refreshAccountOptions } from "@/hooks/use-accounts"
import type { AccountView, ListingDefaults as Defaults, ShopOptions } from "@/lib/accounts/types"
import { timeAgo } from "@/lib/shops/time-ago"

// What every new listing of the account gets on Etsy besides its copy and
// prices. The choices are the shop's own, read when it was connected; where
// the shop left one obvious choice it's picked already. Nothing here changes
// listings that are live.

const WHO_MADE: { value: Defaults["whoMade"]; label: string }[] = [
  { value: "i_did", label: "I did" },
  { value: "collective", label: "A member of my shop" },
  { value: "someone_else", label: "Another company or person" },
]

const WHEN_MADE: { value: Defaults["whenMade"]; label: string }[] = [
  { value: "made_to_order", label: "Made to order" },
  { value: "2020_2026", label: "2020–2026" },
  { value: "2010_2019", label: "2010–2019" },
]

type Shipping = ShopOptions["shippingProfiles"][number]
type Policy = ShopOptions["returnPolicies"][number]

const shippingLabel = (p: Shipping) =>
  [p.title, p.free && "free", p.minDays !== null && `${p.minDays}–${p.maxDays} days`].filter(Boolean).join(" · ")

function policyLabel(p: Policy) {
  const what =
    p.acceptsReturns && p.acceptsExchanges
      ? "Returns and exchanges"
      : p.acceptsReturns
        ? "Returns"
        : p.acceptsExchanges
          ? "Exchanges"
          : "No returns or exchanges"
  return p.deadline && (p.acceptsReturns || p.acceptsExchanges) ? `${what} · ${p.deadline} days` : what
}

export function ListingDefaults({ account }: { account: AccountView }) {
  const [reading, setReading] = React.useState(false)
  const { listing, options } = account
  const save = (patch: Partial<Defaults>) => saveAccount(account.id, { listing: patch })
  const waiting = options ? undefined : "After connecting"

  const shipping = options?.shippingProfiles.find((p) => p.id === listing.shippingProfileId)
  const readiness = options?.readinessStates.find((r) => r.id === listing.readinessStateId)
  const summary = [
    shipping ? shipping.title : "Gelato's shipping",
    readiness?.label,
    listing.materials.join(", ") || "no materials",
    listing.shouldAutoRenew ? "renews" : "doesn't renew",
  ]
    .filter(Boolean)
    .join(" · ")

  async function read() {
    setReading(true)
    try {
      await refreshAccountOptions(account.id)
      toast.success(`Read ${account.shop?.name ?? "the shop"} again`)
    } catch (error) {
      toast.error(`Couldn't read the shop: ${(error as Error).message}`)
    } finally {
      setReading(false)
    }
  }

  return (
    <Collapsible className="group/defaults border-t">
      <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-3 rounded-b-xl px-4 py-3 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset [@media(hover:hover)]:hover:[&>span:first-child]:underline">
        <span className="shrink-0 font-medium underline-offset-2">Listing defaults</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground transition-opacity duration-150 group-data-open/defaults:opacity-0 motion-reduce:transition-none">
          {summary}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out-strong group-data-open/defaults:rotate-180 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out-strong data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <div className="grid gap-x-8 gap-y-3 px-4 pt-1 pb-4 @4xl/main:grid-cols-3">
          <Rows>
            <Row label="Shipping">
              <Choice
                label="Shipping profile"
                value={listing.shippingProfileId}
                items={[
                  { value: null, label: "Gelato's choice" },
                  ...(options?.shippingProfiles ?? []).map((p) => ({ value: p.id, label: shippingLabel(p) })),
                ]}
                placeholder={waiting}
                disabled={!options}
                onChange={(shippingProfileId) => save({ shippingProfileId })}
              />
            </Row>
            <Row label="Returns">
              <Choice
                label="Return policy"
                value={listing.returnPolicyId}
                items={[
                  { value: null, label: "Gelato's choice" },
                  ...(options?.returnPolicies ?? []).map((p) => ({ value: p.id, label: policyLabel(p) })),
                ]}
                placeholder={waiting}
                disabled={!options}
                onChange={(returnPolicyId) => save({ returnPolicyId })}
              />
            </Row>
            <Row label="Processing">
              <Choice
                label="Processing time"
                value={listing.readinessStateId}
                items={[
                  { value: null, label: "Gelato's choice" },
                  ...(options?.readinessStates ?? []).map((r) => ({ value: r.id, label: r.label })),
                ]}
                placeholder={waiting}
                disabled={!options}
                onChange={(readinessStateId) => save({ readinessStateId })}
              />
            </Row>
          </Rows>

          <Rows>
            <Row label="Section">
              <Choice
                label="Shop section"
                value={listing.shopSectionId}
                items={[
                  { value: null, label: "No section" },
                  ...(options?.sections ?? []).map((s) => ({ value: s.id, label: `${s.title} (${s.count})` })),
                ]}
                placeholder={waiting}
                disabled={!options}
                onChange={(shopSectionId) => save({ shopSectionId })}
              />
            </Row>
            <Row label="Made by">
              <Choice
                label="Who made it"
                value={listing.whoMade}
                items={WHO_MADE}
                onChange={(whoMade) => whoMade && save({ whoMade })}
              />
            </Row>
            <Row label="Partner">
              {options?.productionPartners.length ? (
                options.productionPartners.map((p) => {
                  const ids = listing.productionPartnerIds
                  return (
                    <label key={p.id} className="flex min-w-0 items-center gap-2 py-0.5">
                      <Checkbox
                        checked={ids.includes(p.id)}
                        onCheckedChange={(checked) =>
                          save({ productionPartnerIds: checked ? [...ids, p.id] : ids.filter((id) => id !== p.id) })
                        }
                      />
                      <span className="truncate">{p.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{p.location}</span>
                    </label>
                  )
                })
              ) : (
                <span className="text-muted-foreground">{options ? "None in the shop" : "After connecting"}</span>
              )}
            </Row>
          </Rows>

          <Rows>
            <Row label="Made">
              <Choice
                label="When it was made"
                value={listing.whenMade}
                items={WHEN_MADE}
                onChange={(whenMade) => whenMade && save({ whenMade })}
              />
            </Row>
            <Row label="Materials">
              <SavedInput
                value={listing.materials.join(", ")}
                onSave={(text) =>
                  save({
                    materials: text
                      .split(",")
                      .map((m) => m.trim())
                      .filter(Boolean),
                  })
                }
                aria-label="Materials, separated by commas"
                className="w-full"
              />
            </Row>
            <Row label="Renewal">
              <label className="flex items-center gap-2 py-0.5">
                <Switch
                  size="sm"
                  checked={listing.shouldAutoRenew}
                  onCheckedChange={(shouldAutoRenew) => save({ shouldAutoRenew })}
                />
                <span>{listing.shouldAutoRenew ? "Renews automatically" : "Doesn't renew"}</span>
              </label>
              <span className="text-xs text-muted-foreground">Another listing fee every four months</span>
            </Row>
          </Rows>
        </div>
        <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-1.5 text-xs text-muted-foreground">
          <span>
            {options
              ? `Shipping, returns, processing times, partners and sections read from ${account.shop?.name ?? "the shop"} ${timeAgo(options.readAt)}`
              : "Shipping, returns, processing times, partners and sections come from the shop once it's connected"}
          </span>
          {account.connected && (
            <Button variant="ghost" size="xs" onClick={read} disabled={reading} className="-mr-2 ml-auto text-muted-foreground">
              {reading ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <RefreshCwIcon />}
              Read again
            </Button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
