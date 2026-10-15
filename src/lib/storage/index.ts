import { randomBytes } from "node:crypto"

import { encodeKey, s3Error, s3Fetch, type S3Credentials } from "./s3"
import { uplink } from "./uplink"

// The bucket: public file hosting for print files (the place Gelato fetches
// them from when it makes a product), and private storage for the app's own
// images and videos (see files.ts). Any S3-compatible bucket, set up in the
// environment:
//   S3_ENDPOINT    https://fsn1.your-objectstorage.com
//   S3_BUCKET      the bucket's name
//   S3_REGION      optional; Hetzner's location (fsn1, nbg1, hel1) is read off the endpoint
//   S3_PUBLIC_URL  optional; where the bucket's files are public, e.g. https://<bucket>.fsn1.your-objectstorage.com
//   S3_ACCESS_KEY, S3_SECRET_KEY  (or HETZNER_S3_ACCESS_KEY, HETZNER_S3_SECRET_KEY)
//   S3_ACL         public-read (default), or none when a bucket policy makes the files public
// Print files are written public-read and cached for a year: each key holds
// one version of a file (its hash is in the name), so it never changes.

export type StorageStatus = {
  configured: boolean
  /** What's missing, in words, e.g. "S3_BUCKET". */
  missing: string[]
  endpoint: string | null
  bucket: string | null
  publicUrl: string | null
}

type Config = { endpoint: string; bucket: string; publicUrl: string; credentials: S3Credentials; acl: string | null }

const env = (name: string) => process.env[name]?.trim() || null

function readConfig(): { config: Config | null; status: StorageStatus } {
  const endpoint = env("S3_ENDPOINT")?.replace(/\/+$/, "") ?? null
  const bucket = env("S3_BUCKET")
  const accessKey = env("S3_ACCESS_KEY") ?? env("HETZNER_S3_ACCESS_KEY")
  const secretKey = env("S3_SECRET_KEY") ?? env("HETZNER_S3_SECRET_KEY")
  const missing: string[] = []
  if (!endpoint) missing.push("S3_ENDPOINT")
  if (!bucket) missing.push("S3_BUCKET")
  if (!accessKey) missing.push("S3_ACCESS_KEY")
  if (!secretKey) missing.push("S3_SECRET_KEY")
  const publicUrl = env("S3_PUBLIC_URL")?.replace(/\/+$/, "") ?? (endpoint && bucket ? `${endpoint}/${bucket}` : null)
  const status: StorageStatus = { configured: !missing.length, missing, endpoint, bucket, publicUrl }
  if (missing.length) return { config: null, status }
  const host = new URL(endpoint!).hostname
  const region = env("S3_REGION") ?? /^([a-z0-9]+)\.your-objectstorage\.com$/.exec(host)?.[1] ?? "us-east-1"
  const acl = env("S3_ACL") === "none" ? null : (env("S3_ACL") ?? "public-read")
  return {
    config: {
      endpoint: endpoint!,
      bucket: bucket!,
      publicUrl: publicUrl!,
      credentials: { accessKey: accessKey!, secretKey: secretKey!, region },
      acl,
    },
    status,
  }
}

export async function storageStatus(): Promise<StorageStatus> {
  return readConfig().status
}

function configured() {
  const { config, status } = readConfig()
  if (!config) throw new Error(`Object storage isn't set up: ${status.missing.join(", ")} missing`)
  return config
}

const objectUrl = (config: Config, key: string) => new URL(`${config.endpoint}/${config.bucket}/${encodeKey(key)}`)

/** Where Gelato (or anyone) reads `key`. */
export function publicUrl(key: string) {
  return `${configured().publicUrl}/${encodeKey(key)}`
}

// Buckets with ACLs switched off (AWS's default since 2023) refuse the ACL
// header; then it's left off and a bucket policy has to make files public.
const global = globalThis as typeof globalThis & { __storageNoAcl?: boolean }

/** Uploads `data` under `key` and returns the public URL. */
export async function uploadPublic(key: string, data: Uint8Array, contentType: string): Promise<string> {
  await putObject(key, data, contentType, true)
  return publicUrl(key)
}

/**
 * Copies the object at `from` to `to`, publicly readable, inside the bucket
 * (S3 CopyObject): nothing goes over this machine's line. Answers with the
 * public URL.
 */
export async function copyPublic(from: string, to: string, contentType: string): Promise<string> {
  const config = configured()
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "x-amz-copy-source": `/${config.bucket}/${encodeKey(from)}`,
      "x-amz-metadata-directive": "REPLACE",
    }
    if (config.acl && !global.__storageNoAcl) headers["x-amz-acl"] = config.acl
    let res: Response
    try {
      res = await s3Fetch("PUT", objectUrl(config, to), config.credentials, { headers })
    } catch (error) {
      if (attempt < 3) {
        await sleep(1000 * 2 ** attempt)
        continue
      }
      throw new Error(`Object storage unreachable: ${(error as Error).message}`)
    }
    const text = await res.text().catch(() => "")
    // A copy can fail after S3 has answered 200: the error is then in the body.
    if (res.ok && !text.includes("<Error>")) return publicUrl(to)
    const status = res.ok ? 500 : res.status
    const { code, message } = s3Error(status, text)
    if (code === "AccessControlListNotSupported" && !global.__storageNoAcl) {
      global.__storageNoAcl = true
      continue
    }
    if ((status >= 500 || status === 429) && attempt < 3) {
      await sleep(1000 * 2 ** attempt)
      continue
    }
    throw new Error(`Print file copy failed (${status}): ${message}`)
  }
}

/** Uploads `data` under `key`: publicly readable, or private (the default). */
export async function putObject(key: string, data: Uint8Array, contentType: string, open = false) {
  const config = configured()
  const what = open ? "Print file" : "File"
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { "Content-Type": contentType }
    if (open) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable"
      if (config.acl && !global.__storageNoAcl) headers["x-amz-acl"] = config.acl
    }
    let res: Response
    try {
      // Sharing the line with the database's queries (see uplink.ts).
      res = await uplink(data.byteLength, () => s3Fetch("PUT", objectUrl(config, key), config.credentials, { body: data, headers }))
    } catch (error) {
      if (attempt < 3) {
        await sleep(1000 * 2 ** attempt)
        continue
      }
      throw new Error(`Object storage unreachable: ${(error as Error).message}`)
    }
    if (res.ok) return
    const { code, message } = s3Error(res.status, await res.text().catch(() => ""))
    if (code === "AccessControlListNotSupported" && !global.__storageNoAcl) {
      global.__storageNoAcl = true
      continue
    }
    if ((res.status >= 500 || res.status === 429) && attempt < 3) {
      await sleep(1000 * 2 ** attempt)
      continue
    }
    throw new Error(`${what} upload failed (${res.status}): ${message}`)
  }
}

/** The object at `key`, or null when there's none. */
export async function getObject(key: string): Promise<Buffer | null> {
  const config = configured()
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await s3Fetch("GET", objectUrl(config, key), config.credentials)
    } catch (error) {
      if (attempt < 3) {
        await sleep(500 * 2 ** attempt)
        continue
      }
      throw new Error(`Object storage unreachable: ${(error as Error).message}`)
    }
    if (res.ok) return Buffer.from(await res.arrayBuffer())
    if (res.status === 404) return null
    const { message } = s3Error(res.status, await res.text().catch(() => ""))
    if ((res.status >= 500 || res.status === 429) && attempt < 3) {
      await sleep(500 * 2 ** attempt)
      continue
    }
    throw new Error(`Couldn't download ${key} (${res.status}): ${message}`)
  }
}

export async function deleteObject(key: string): Promise<void> {
  const config = configured()
  const res = await s3Fetch("DELETE", objectUrl(config, key), config.credentials)
  if (!res.ok && res.status !== 404) {
    throw new Error(`Couldn't delete ${key} (${res.status}): ${s3Error(res.status, await res.text().catch(() => "")).message}`)
  }
}

/** Uploads a small file, reads it back from its public URL and deletes it. */
export async function testStorage(): Promise<{ ok: boolean; url?: string; error?: string; ms: number }> {
  const started = Date.now()
  const key = `pipeline-test/${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.txt`
  const content = `print file hosting works · ${new Date().toISOString()}`
  let url: string | undefined
  try {
    url = await uploadPublic(key, Buffer.from(content), "text/plain; charset=utf-8")
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) {
      throw new Error(
        `Uploaded, but the public address answers ${res.status}: the files must be publicly readable (bucket policy or S3_ACL=public-read)`
      )
    }
    if ((await res.text()) !== content) throw new Error("Uploaded, but the public address returns something else")
    return { ok: true, url, ms: Date.now() - started }
  } catch (error) {
    return { ok: false, url, error: (error as Error).message, ms: Date.now() - started }
  } finally {
    if (url) await deleteObject(key).catch(() => {})
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
