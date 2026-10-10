import { createHash, randomBytes } from "node:crypto"

import { changeTokens, getKey, getTokens } from "@/lib/accounts/store"
import { ETSY_SCOPES, type AccountTokens } from "@/lib/accounts/types"

// OAuth 2 with PKCE, one grant per shop. Scopes hang on the grant, not on the
// refresh: one added later means connecting again, so everything the app will
// ever need is asked for up front. Access tokens last an hour and are renewed
// here, one renewal per account at a time; each renewal brings a new refresh
// token, good for 90 days. A grant Etsy refuses to renew (revoked by the shop
// owner, or the app's key changed) is marked, so Settings asks for a new one
// instead of every request failing on its own.

const CONNECT_URL = "https://www.etsy.com/oauth/connect"
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token"

export const SCOPES = [...ETSY_SCOPES]

/** Etsy needs this exact address among the app's callback URLs. */
export const callbackPath = "/api/accounts/oauth/callback"

/**
 * Where the browser reaches this app: APP_URL when set, else the forwarded
 * host (behind a proxy), else the request's own origin. The callback URL is
 * built from it, so it has to be the address the shop owner's browser uses.
 */
export function publicOrigin(request: Request) {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "")
  if (configured) return configured
  const url = new URL(request.url)
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || url.host
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(/:$/, "")
  return `${proto}://${host}`
}

type Pending = { account: string; verifier: string; redirectUri: string; createdAt: number }

const global = globalThis as typeof globalThis & {
  __oauthPending?: Map<string, Pending>
  __oauthRefresh?: Map<string, Promise<AccountTokens>>
}
const pending = (global.__oauthPending ??= new Map())
const refreshing = (global.__oauthRefresh ??= new Map())

const PENDING_MS = 30 * 60 * 1000
const EARLY_MS = 5 * 60 * 1000

/** Where to send the shop owner to grant access. */
export async function connectUrl(account: string, origin: string) {
  const key = await getKey(account)
  if (!key) throw new Error(`Add ${account}'s API key first`)
  for (const [state, p] of pending) if (Date.now() - p.createdAt > PENDING_MS) pending.delete(state)

  const verifier = randomBytes(48).toString("base64url")
  const state = randomBytes(16).toString("base64url")
  const redirectUri = origin + callbackPath
  pending.set(state, { account, verifier, redirectUri, createdAt: Date.now() })

  const url = new URL(CONNECT_URL)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", key.keystring)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("scope", SCOPES.join(" "))
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"))
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

/** The account a sign-in was started for, while Etsy hasn't answered yet. */
export const pendingAccount = (state: string) => pending.get(state)?.account ?? null

/**
 * Trades the code Etsy sent back for a grant. It isn't kept yet: the caller
 * first checks it belongs to the account's shop (see accounts/connect).
 */
export async function exchangeCode(state: string, code: string): Promise<{ account: string; tokens: AccountTokens }> {
  const p = pending.get(state)
  pending.delete(state)
  if (!p || Date.now() - p.createdAt > PENDING_MS) throw new Error("This sign-in ran out. Start it again from Settings.")
  const key = await getKey(p.account)
  if (!key) throw new Error(`${p.account} has no API key`)
  const answer = await tokenRequest(key.keystring, key.secret, {
    grant_type: "authorization_code",
    client_id: key.keystring,
    redirect_uri: p.redirectUri,
    code,
    code_verifier: p.verifier,
  })
  if (!answer.refreshToken) throw new Error("Etsy sent no refresh token")
  return { account: p.account, tokens: { ...answer, refreshToken: answer.refreshToken } }
}

/** Forgets a sign-in that came back without a code (the shop owner said no). */
export const cancelConnect = (state: string) => pending.delete(state)

class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string
  ) {
    super(message)
    this.name = "OAuthError"
  }
}

async function tokenRequest(keystring: string, secret: string, form: Record<string, string>) {
  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-api-key": `${keystring}:${secret}`,
        "User-Agent": "etsy-dashboard/1.0",
      },
      body: new URLSearchParams(form),
      cache: "no-store",
    })
  } catch (error) {
    throw new OAuthError(503, null, `Etsy unreachable: ${(error as Error).message}`)
  }
  const body = (await res.json().catch(() => null)) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    error?: string
    error_description?: string
  } | null
  if (!res.ok || !body?.access_token) {
    throw new OAuthError(res.status, body?.error ?? null, body?.error_description ?? body?.error ?? res.statusText)
  }
  const now = Date.now()
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: now + (body.expires_in ?? 3600) * 1000,
    // Etsy's consent is all or nothing: what was asked for is what was granted.
    scope: body.scope ?? SCOPES.join(" "),
    // Etsy's access tokens start with the user id: "12345678.abc…".
    userId: Number(body.access_token.split(".")[0]) || 0,
    obtainedAt: now,
  }
}

/** A valid access token for `account`, renewed when it's close to running out. */
export async function accessToken(account: string): Promise<string> {
  const tokens = await getTokens(account)
  if (!tokens) throw new Error(`${account} isn't connected to Etsy. Connect it in Settings.`)
  if (tokens.error) throw new Error(`${account}'s Etsy connection stopped working (${tokens.error}). Connect it again in Settings.`)
  if (tokens.expiresAt - EARLY_MS > Date.now()) return tokens.accessToken
  return (await refresh(account)).accessToken
}

/** Forgets the access token after Etsy turned it down, so the next call renews it. */
export async function dropAccessToken(account: string) {
  await changeTokens(account, async (tokens) => tokens && { ...tokens, expiresAt: 0 })
}

function refresh(account: string) {
  let running = refreshing.get(account)
  if (!running) {
    running = (async () => {
      const key = await getKey(account)
      if (!key) throw new Error(`${account} has no API key`)
      let refused: string | undefined
      // Holds the tokens on every server while Etsy answers: a second renewal
      // would send the refresh token this one is using up.
      const renewed = await changeTokens(account, async (stored) => {
        if (!stored) throw new Error(`${account} isn't connected to Etsy. Connect it in Settings.`)
        // Someone else renewed it (or found it refused) while this one waited.
        if (stored.error) {
          refused = stored.error
          return stored
        }
        if (stored.expiresAt - EARLY_MS > Date.now()) return stored
        let answer: Awaited<ReturnType<typeof tokenRequest>>
        try {
          answer = await tokenRequest(key.keystring, key.secret, {
            grant_type: "refresh_token",
            client_id: key.keystring,
            refresh_token: stored.refreshToken,
          })
        } catch (error) {
          // Refused outright, not just unreachable: no retry will help.
          if (error instanceof OAuthError && (error.code === "invalid_grant" || error.status === 401)) {
            refused = error.message
            return { ...stored, error: error.message }
          }
          throw new Error(`${account}: Etsy didn't renew the connection (${(error as Error).message})`)
        }
        return {
          ...answer,
          // Without a new refresh token the old one, and its 90 days, stay.
          refreshToken: answer.refreshToken ?? stored.refreshToken,
          obtainedAt: answer.refreshToken ? answer.obtainedAt : stored.obtainedAt,
          scope: stored.scope || answer.scope,
          userId: answer.userId || stored.userId,
        }
      })
      if (refused || !renewed) throw new Error(`${account}: Etsy didn't renew the connection (${refused ?? "not connected"})`)
      return renewed
    })().finally(() => refreshing.delete(account))
    refreshing.set(account, running)
  }
  return running
}
