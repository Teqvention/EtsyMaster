import { createHash, createHmac } from "node:crypto"
import http from "node:http"
import https from "node:https"

// AWS Signature Version 4 for S3-compatible storage (Hetzner Object Storage,
// AWS, R2…), the few requests the app needs, without an SDK. Every request is
// signed over its payload's SHA-256.

export type S3Credentials = { accessKey: string; secretKey: string; region: string }

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex")
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest()

/** RFC 3986 encoding of one path segment or query part, as SigV4 wants it. */
export const encodePart = (part: string) =>
  encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export const encodeKey = (key: string) => key.split("/").map(encodePart).join("/")

/**
 * The headers that sign `method url` with `payloadHash` (hex SHA-256 of the
 * body): x-amz-date, x-amz-content-sha256 and Authorization, plus the ones
 * passed in. `url` must already have its path encoded.
 */
export function signRequest({
  method,
  url,
  headers = {},
  payloadHash,
  credentials,
  date = new Date(),
}: {
  method: string
  url: URL
  headers?: Record<string, string>
  payloadHash: string
  credentials: S3Credentials
  date?: Date
}) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const day = amzDate.slice(0, 8)
  const all: Record<string, string> = {
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  }
  const names = Object.keys(all).sort()
  const canonicalHeaders = names.map((n) => `${n}:${all[n].trim().replace(/\s+/g, " ")}\n`).join("")
  const query = [...url.searchParams]
    .map(([k, v]) => [encodePart(k), encodePart(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  const canonicalRequest = [method, url.pathname, query, canonicalHeaders, names.join(";"), payloadHash].join("\n")
  const scope = `${day}/${credentials.region}/s3/aws4_request`
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n")
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretKey}`, day), credentials.region), "s3"), "aws4_request")
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex")
  const { host, ...rest } = all
  void host
  return {
    ...rest,
    Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  }
}

/** One signed request; the body's hash is worked out here. */
export async function s3Fetch(
  method: "GET" | "PUT" | "DELETE" | "HEAD",
  url: URL,
  credentials: S3Credentials,
  { body, headers }: { body?: Uint8Array; headers?: Record<string, string> } = {}
) {
  const signed = signRequest({
    method,
    url,
    headers,
    payloadHash: sha256(body ?? new Uint8Array()),
    credentials,
  })
  return send(method, url, { ...signed, "Content-Length": String(body?.byteLength ?? 0) }, body)
}

// HTTP/1.1 on kept-alive connections rather than fetch: Node's fetch speaks
// HTTP/2 where it can, and Hetzner cuts off a connection carrying many
// transfers at once (NGHTTP2_ENHANCE_YOUR_CALM).
const agents = {
  "http:": new http.Agent({ keepAlive: true, maxSockets: 8 }),
  "https:": new https.Agent({ keepAlive: true, maxSockets: 8 }),
}

function send(method: string, url: URL, headers: Record<string, string>, body?: Uint8Array) {
  const client = url.protocol === "http:" ? http : https
  return new Promise<Response>((resolve, reject) => {
    const request = client.request(url, { method, headers, agent: agents[url.protocol === "http:" ? "http:" : "https:"] }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (chunk: Buffer) => chunks.push(chunk))
      res.on("error", reject)
      res.on("end", () => {
        const status = res.statusCode ?? 502
        const empty = method === "HEAD" || status === 204 || status === 304
        const fields = Object.entries(res.headers).flatMap(([name, value]) =>
          value === undefined ? [] : (Array.isArray(value) ? value : [value]).map((v): [string, string] => [name, v])
        )
        resolve(new Response(empty ? null : Buffer.concat(chunks), { status, headers: fields }))
      })
    })
    request.setTimeout(120_000, () => request.destroy(new Error("No answer from object storage in 2 minutes")))
    request.on("error", reject)
    request.end(body)
  })
}

/** S3's error code and message out of its XML answer. */
export function s3Error(status: number, text: string) {
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1]
  const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1]
  return { code: code ?? null, message: [code, message].filter(Boolean).join(": ") || `HTTP ${status}` }
}
