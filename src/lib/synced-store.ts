"use client"

import { toast } from "sonner"

// Data the user makes (tags, likes, presets…) lives in the database. A store
// made here shows a change at once and sends it as a step the server applies
// in a transaction; until the server has answered, the step waits in the
// browser (kept across reloads, sent again once the server can be reached)
// and is shown on top of the server's copy. The browser keeps that copy only
// to show it before the server answers. What an older version kept in the
// browser alone is folded into the server's once, then cleared. Back on the
// tab, the server's copy is read again, for what other tabs and addresses
// changed.

/** Changes going out together. */
const SEND_AFTER_MS = 300
/** After a failed send, try again this much later. */
const RETRY_MS = 15_000
/** Back on the tab after this long, the server's copy is read again. */
const REFRESH_MS = 5_000

export type SyncedStore<T, Op> = {
  /** What's on show; stable between changes, for `useSyncExternalStore`. */
  read: () => T
  subscribe: (notify: () => void) => () => void
  /** Shows a change at once and sends it. */
  change: (op: Op) => void
}

export function createSyncedStore<T, Op>({
  api,
  key,
  legacyKey,
  empty,
  apply,
  fromLegacy = (legacy) => legacy as T,
  what,
}: {
  /** GET answers with the data; PATCH `{ ops }` applies steps and PUT folds a copy in, both answering with the data. */
  api: string
  /** Where the browser keeps its copy (`key`) and its unconfirmed steps (`key`-outbox). */
  key: string
  /** Where an older version kept the data in the browser alone. */
  legacyKey?: string
  empty: T
  apply: (data: T, ops: Op[]) => T
  /** An older version's data, as the server takes it. */
  fromLegacy?: (legacy: unknown) => T
  /** Named in the message when saving fails, e.g. "the shop list". */
  what: string
}): SyncedStore<T, Op> {
  const cacheKey = `${key}-cache`
  const outboxKey = `${key}-outbox`
  const listeners = new Set<() => void>()
  let started = false
  let base = empty
  let outbox: Op[] = []
  let view = empty
  /** Bumped by every confirmed change: a read begun before one is out of date. */
  let confirmed = 0
  let loading: Promise<void> | null = null
  let loaded = false
  let loadedAt = 0
  let sending = false
  let sendTimer: ReturnType<typeof setTimeout> | undefined

  function stored<V>(name: string): V | null {
    try {
      const raw = localStorage.getItem(name)
      return raw ? (JSON.parse(raw) as V) : null
    } catch {
      return null
    }
  }

  function keep(name: string, value: unknown) {
    try {
      localStorage.setItem(name, JSON.stringify(value))
    } catch {
      // Full or blocked: the server has it all the same.
    }
  }

  function read() {
    if (!started) {
      started = true
      const legacy = legacyKey ? stored<unknown>(legacyKey) : null
      base = stored<T>(cacheKey) ?? (legacy ? fromLegacy(legacy) : empty)
      outbox = stored<Op[]>(outboxKey) ?? []
      view = outbox.length ? apply(base, outbox) : base
    }
    return view
  }

  function show() {
    view = outbox.length ? apply(base, outbox) : base
    listeners.forEach((notify) => notify())
  }

  function setBase(next: T) {
    base = next
    keep(cacheKey, next)
    show()
  }

  async function call(method: "GET" | "PATCH" | "PUT", body?: unknown): Promise<T> {
    const res = await fetch(api, {
      method,
      cache: "no-store",
      ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
    return (await res.json()) as T
  }

  function complain(error: unknown) {
    console.error(`Saving ${what}:`, error)
    toast.error(`Couldn't save ${what}`, {
      id: `synced:${api}`,
      description: "The change is kept in this browser and sent as soon as the server answers.",
    })
  }

  function load() {
    loading ??= (async () => {
      const legacy = legacyKey ? stored<unknown>(legacyKey) : null
      const since = confirmed
      const data = legacy ? await call("PUT", fromLegacy(legacy)) : await call("GET")
      if (legacy && legacyKey) localStorage.removeItem(legacyKey)
      if (since === confirmed) setBase(data)
      loaded = true
      loadedAt = Date.now()
      void send()
    })().catch((error) => {
      loading = null
      complain(error)
    })
    return loading
  }

  function sendSoon(delay = SEND_AFTER_MS) {
    clearTimeout(sendTimer)
    sendTimer = setTimeout(() => void send(), delay)
  }

  async function send() {
    if (sending || !loaded || outbox.length === 0) return
    sending = true
    const ops = outbox.slice()
    try {
      const data = await call("PATCH", { ops })
      outbox = outbox.slice(ops.length)
      keep(outboxKey, outbox)
      confirmed++
      setBase(data)
      if (outbox.length) sendSoon()
    } catch (error) {
      complain(error)
      sendSoon(RETRY_MS)
    } finally {
      sending = false
    }
  }

  function refresh() {
    if (document.visibilityState !== "visible") return
    if (!loaded) return void load()
    if (Date.now() - loadedAt < REFRESH_MS) return
    loadedAt = Date.now()
    const since = confirmed
    call("GET")
      .then((data) => since === confirmed && setBase(data))
      .catch((error) => console.error(`Loading ${what}:`, error))
    void send()
  }

  function subscribe(notify: () => void) {
    listeners.add(notify)
    void load()
    // Another tab of this address confirmed something.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== cacheKey) return
      base = stored<T>(cacheKey) ?? base
      show()
    }
    window.addEventListener("storage", onStorage)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      listeners.delete(notify)
      window.removeEventListener("storage", onStorage)
      document.removeEventListener("visibilitychange", refresh)
    }
  }

  function change(op: Op) {
    read()
    outbox = [...outbox, op]
    keep(outboxKey, outbox)
    show()
    sendSoon()
  }

  return { read, subscribe, change }
}
