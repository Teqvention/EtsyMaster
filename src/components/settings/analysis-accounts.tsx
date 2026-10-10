"use client"

import { PlusIcon } from "lucide-react"

import { AccountMenu } from "@/components/settings/account-dialogs"
import { ConnectButton, Section, Status } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import type { AccountView } from "@/lib/accounts/types"

// The accounts serving public reads (research, shop analyses, the keyword
// library), the less used one first. Their key is all they need; one whose
// shop is ours is connected too, so its sales sync.

export function AnalysisAccounts({ accounts, onAdd }: { accounts: AccountView[]; onAdd: () => void }) {
  return (
    <Section
      title="Analysis accounts"
      aside={
        <Button variant="ghost" size="xs" onClick={onAdd} className="-mr-1 text-muted-foreground active:scale-[0.97]">
          <PlusIcon />
          Add
        </Button>
      }
    >
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="-mx-1 flex flex-col">
          {accounts.map((account) => (
            <AnalysisRow key={account.id} account={account} />
          ))}
        </ul>
      )}
    </Section>
  )
}

function AnalysisRow({ account }: { account: AccountView }) {
  const details = [
    account.hasKey ? `App ${account.appId ?? "key saved"}` : "No key",
    account.shop && account.shop.name !== account.label && account.shop.name,
    account.gelato?.storeName && `Gelato ${account.gelato.storeName}`,
  ].filter(Boolean)

  return (
    <li className="flex items-center gap-2 rounded-md px-1 py-1.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{account.label}</span>
        <span className="truncate text-[11px] text-muted-foreground tabular-nums">{details.join(" · ")}</span>
      </div>
      {account.shop &&
        (account.connected ? (
          <Status tone="ok" className="shrink-0 text-xs text-muted-foreground">
            Connected
          </Status>
        ) : account.hasKey ? (
          <ConnectButton
            account={account}
            variant="outline"
            size="xs"
            title={account.connectionError ?? "Connect, signed in to Etsy as the shop's owner, so its sales sync"}
            className="shrink-0 active:scale-[0.97]"
          >
            {account.connectionError ? "Connect again" : "Connect"}
          </ConnectButton>
        ) : null)}
      <AccountMenu account={account} />
    </li>
  )
}
