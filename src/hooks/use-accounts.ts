"use client"

import * as React from "react"

import type { AccountPatch, AccountRole, AccountView } from "@/lib/accounts/types"

// The Etsy accounts as Settings shows them (no keys, no tokens), shared by
// every page that offers a choice of account: Uploads, Artikel, Performance.

export type AccountsState = {
  accounts: AccountView[]
  /** The address each Etsy app must list as its callback. */
  callbackUrl: string
}

const listeners = new Set<() => void>()
let state: AccountsState | null = null

function set(next: AccountsState) {
  state = next
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void) {
  listeners.add(notify)
  if (state === null) refreshAccounts()
  return () => {
    listeners.delete(notify)
  }
}

/** Null until loaded. */
export function useAccounts() {
  return React.useSyncExternalStore(subscribe, () => state, () => null)
}

/** Upload accounts first, in the order Settings lists them. */
export const uploadAccounts = (s: AccountsState | null) => s?.accounts.filter((a) => a.role === "upload") ?? []

/** Loads the accounts again; resolves to them (null if they never loaded). */
export async function refreshAccounts() {
  try {
    const response = await fetch("/api/accounts", { cache: "no-store" })
    if (response.ok) set(await response.json())
  } catch {
    // Keep what's there; the next visit tries again.
  }
  return state
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? response.statusText)
  return result as T
}

function replace(account: AccountView) {
  if (state) set({ ...state, accounts: state.accounts.map((a) => (a.id === account.id ? account : a)) })
}

/**
 * Change an account; `keystring` + `secret` replace its key, `disconnect`
 * forgets its Etsy grant. A new key or Gelato template is checked before the
 * answer comes, so that can take a second or two.
 */
export async function patchAccount(
  id: string,
  patch: AccountPatch & { keystring?: string; secret?: string; disconnect?: true }
) {
  const account = await call<AccountView>(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(patch) })
  replace(account)
  return account
}

export async function addAccount(init: { label: string; role: AccountRole; keystring: string; secret: string; appId?: string }) {
  const account = await call<AccountView>("/api/accounts", { method: "POST", body: JSON.stringify(init) })
  await refreshAccounts()
  return account
}

export async function deleteAccount(id: string) {
  await call(`/api/accounts/${id}`, { method: "DELETE" })
  if (state) set({ ...state, accounts: state.accounts.filter((a) => a.id !== id) })
}

/** Reads the shop's shipping profiles, policies, sections… again. */
export async function refreshAccountOptions(id: string) {
  replace(await call<AccountView>(`/api/accounts/${id}/refresh`, { method: "POST" }))
}

/** Checks the account's Gelato templates against the offered sizes again. */
export async function checkTemplates(id: string) {
  replace(await call<AccountView>(`/api/accounts/${id}/templates`, { method: "POST" }))
}
