// Copies this machine's data/ folder into the shared database and bucket:
// every JSON file becomes a document (data/pricing/fx.json → "pricing/fx"),
// every image and video a file in the bucket under data/<path>, indexed in
// the database (see src/lib/db/schema.ts and src/lib/storage/files.ts).
//
//   pnpm data:push                 adds what the database doesn't have yet
//   pnpm data:push --dry           only says what it would do
//   pnpm data:push --overwrite     also replaces what differs from data/
//
// Safe to run again: what's there already is left alone (the app may have
// changed it since), unless --overwrite. Each file it uploads goes into this
// machine's cache too (.cache/files), so the app needn't download it again.

import { createHash } from "node:crypto"
import { copyFile, link, mkdir, readdir, readFile } from "node:fs/promises"
import path from "node:path"

import postgres from "postgres"

import { SCHEMA } from "../src/lib/db/schema.ts"
import { encodeKey, s3Error, s3Fetch } from "../src/lib/storage/s3.ts"

const DATA = path.resolve("data")
const CACHE = path.resolve(".cache", "files")
const dry = process.argv.includes("--dry")
const overwrite = process.argv.includes("--overwrite")

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4" }

const env = (name) => process.env[name]?.trim() || null

function bucket() {
  const endpoint = env("S3_ENDPOINT")?.replace(/\/+$/, "")
  const name = env("S3_BUCKET")
  const accessKey = env("S3_ACCESS_KEY") ?? env("HETZNER_S3_ACCESS_KEY")
  const secretKey = env("S3_SECRET_KEY") ?? env("HETZNER_S3_SECRET_KEY")
  const missing = Object.entries({ S3_ENDPOINT: endpoint, S3_BUCKET: name, S3_ACCESS_KEY: accessKey, S3_SECRET_KEY: secretKey })
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) throw new Error(`Object storage isn't set up: ${missing.join(", ")} missing`)
  const host = new URL(endpoint).hostname
  const region = env("S3_REGION") ?? /^([a-z0-9]+)\.your-objectstorage\.com$/.exec(host)?.[1] ?? "us-east-1"
  return { endpoint, name, credentials: { accessKey, secretKey, region } }
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name.endsWith(".tmp")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex")
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`

/** Uploads `data` under data/<key>, unless the bucket has these bytes there already (from an earlier run); answers whether it did. */
async function upload(store, key, data, type) {
  const url = new URL(`${store.endpoint}/${store.name}/${encodeKey(`data/${key}`)}`)
  // A single upload's ETag is its MD5.
  const head = await s3Fetch("HEAD", url, store.credentials).catch(() => null)
  if (head?.ok && head.headers.get("etag")?.replaceAll('"', "") === createHash("md5").update(data).digest("hex")) return false
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await s3Fetch("PUT", url, store.credentials, { body: data, headers: { "Content-Type": type } })
      if (res.ok) return true
      const { message } = s3Error(res.status, await res.text().catch(() => ""))
      if ((res.status < 500 && res.status !== 429) || attempt >= 5) throw new Error(`${key}: upload failed (${res.status}): ${message}`)
    } catch (error) {
      if (/upload failed/.test(error.message)) throw error
      // A dropped connection: worth a few more tries.
      if (attempt >= 5) throw new Error(`${key}: upload failed: ${error.cause?.message ?? error.message}`)
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
  }
}

/** This machine's copy, so the app reads it from disk rather than the bucket. */
async function keep(file, hash) {
  const target = path.join(CACHE, hash.slice(0, 2), hash)
  await mkdir(path.dirname(target), { recursive: true })
  await link(file, target).catch((error) => {
    if (error.code === "EEXIST") return
    return copyFile(file, target)
  })
}

async function main() {
  if (!env("DATABASE_URL")) throw new Error("DATABASE_URL isn't set: add the shared database's address to .env")
  const store = bucket()
  const sql = postgres(env("DATABASE_URL"), { max: 4, onnotice: () => {}, connect_timeout: 15 })
  try {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('schema', 0))`
      await tx.unsafe(SCHEMA)
    })

    const documents = []
    const files = []
    for await (const full of walk(DATA)) {
      const relative = path.relative(DATA, full).split(path.sep).join("/")
      const extension = relative.split(".").pop().toLowerCase()
      if (extension === "json") documents.push({ full, key: relative.slice(0, -".json".length) })
      else if (TYPES[extension]) files.push({ full, key: relative, type: TYPES[extension] })
      else console.warn(`Skipped ${relative}: not JSON, an image or a video`)
    }
    console.log(`data/: ${documents.length} JSON files, ${files.length} images and videos${dry ? " (dry run)" : ""}`)

    // --- Documents ---
    const stored = new Map(
      (await sql`select key, md5(value::text) as hash from documents`).map((r) => [r.key, r.hash])
    )
    const counts = { added: 0, replaced: 0, same: 0, differs: 0 }
    for (const { full, key } of documents) {
      let text
      try {
        text = JSON.stringify(JSON.parse(await readFile(full, "utf8")))
      } catch (error) {
        console.warn(`Skipped ${key}.json: ${error.message}`)
        continue
      }
      const before = stored.get(key)
      const hash = createHash("md5").update(text).digest("hex")
      if (before === hash) {
        counts.same++
        continue
      }
      if (before && !overwrite) {
        counts.differs++
        continue
      }
      if (!dry) {
        await sql`
          insert into documents (key, value) values (${key}, ${text}::text::json)
          on conflict (key) do update set value = excluded.value, version = documents.version + 1, updated_at = now()`
      }
      counts[before ? "replaced" : "added"]++
      console.log(`${dry ? "Would " : ""}${before ? "replace" : "add"} document ${key} (${mb(text.length)})`)
    }
    console.log(
      `Documents: ${counts.added} added, ${counts.replaced} replaced, ${counts.same} already there` +
        (counts.differs ? `, ${counts.differs} differ in the database and were left alone (--overwrite replaces them)` : "")
    )

    // --- Files ---
    const indexed = new Map((await sql`select key, hash from files`).map((r) => [r.key, r.hash]))
    const done = { uploaded: 0, replaced: 0, same: 0, differs: 0, bytes: 0, inBucket: 0 }
    const failed = []
    let next = 0
    const worker = async () => {
      while (next < files.length) {
        const { full, key, type } = files[next++]
        const data = await readFile(full)
        const hash = sha256(data)
        const before = indexed.get(key)
        if (before === hash) {
          done.same++
          if (!dry) await keep(full, hash)
          continue
        }
        if (before && !overwrite) {
          done.differs++
          continue
        }
        if (!dry) {
          // One that won't go up doesn't stop the rest; running this again retries it.
          const sent = await upload(store, key, data, type).catch((error) => {
            failed.push(key)
            console.warn(error.message)
            return null
          })
          if (sent === null) continue
          if (!sent) done.inBucket++
          await sql`
            insert into files (key, size, hash, type) values (${key}, ${data.byteLength}, ${hash}, ${type})
            on conflict (key) do update set size = excluded.size, hash = excluded.hash, type = excluded.type, updated_at = now()`
          await keep(full, hash)
        }
        done[before ? "replaced" : "uploaded"]++
        done.bytes += data.byteLength
        const count = done.uploaded + done.replaced
        if (count % 25 === 0) console.log(`${dry ? "Would upload" : "Uploaded"} ${count} files, ${mb(done.bytes)}…`)
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker))
    console.log(
      `Files: ${done.uploaded} uploaded, ${done.replaced} replaced (${mb(done.bytes)}; ${done.inBucket} of them were in the bucket already), ${done.same} already there` +
        (done.differs ? `, ${done.differs} differ in the bucket and were left alone (--overwrite replaces them)` : "")
    )
    if (failed.length) {
      console.error(`${failed.length} couldn't be uploaded (run this again to retry them): ${failed.join(", ")}`)
      process.exitCode = 1
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error(error.message ?? error)
  process.exit(1)
})
