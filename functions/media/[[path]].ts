/**
 * The hub's private media. GET /media/<key> answers with the object <key> from
 * the R2 bucket named media, bound as MEDIA, so
 * /media/math/k_d_tree/median_axis_split.3f9a1c07.mp4 serves the object
 * math/k_d_tree/median_axis_split.3f9a1c07.mp4.
 *
 * Keys carry a hash of their bytes and nothing overwrites or deletes an object,
 * so an address always means the same file. The uploader stores that promise as
 * each object's Cache-Control, and writeHttpMetadata passes it on.
 *
 * Range is resolved here rather than left to R2 because video players depend on
 * it: Safari opens every clip with bytes=0-1 and will not play one that does not
 * come back as a 206.
 */

interface Env {
  MEDIA: R2Bucket
}

// Only hub.dreds.info sits behind the Cloudflare Access login. The project's
// *.pages.dev addresses (production and every preview deploy) run this same
// function with no login in front, so media answers on the hub hostname alone —
// plus localhost and 127.0.0.1, which is `wrangler pages dev`.
const HOSTS = new Set(["hub.dreds.info", "localhost", "127.0.0.1"])

// For objects stored without a Content-Type.
const TYPES = new Map([
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
])

type ByteRange = { offset: number; length: number }

export const onRequest: PagesFunction<Env, "path"> = async ({ request, env, params }) => {
  if (!HOSTS.has(new URL(request.url).hostname)) return notFound()
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } })
  }

  const key = objectKey(params.path)
  if (key === undefined) return notFound()

  // Size and ETag first: a Range can only be resolved against them. The get
  // below still opens the whole object for a HEAD or a 416, and drops the body
  // unread, so that R2 judges the If-* headers before anything else.
  const stat = await env.MEDIA.head(key)
  if (stat === null) return notFound()
  const range = requestedRange(request, stat)

  const object = await env.MEDIA.get(key, {
    onlyIf: request.headers,
    range: range === "unsatisfiable" ? undefined : range,
  })
  if (object === null) return notFound()

  const headers = new Headers({
    ETag: object.httpEtag,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  })

  // R2 leaves the body off when an If-* header fails. Preconditions outrank
  // Range (RFC 9110 §13.2.2), so they are answered first: a failed If-Match or
  // If-Unmodified-Since is a 412, while a failed If-None-Match or
  // If-Modified-Since means the client's copy is current, a 304.
  if (!("body" in object)) {
    if (preconditionFailed(request, object)) return refuse(412, headers)
    describe(object, key, headers)
    return new Response(null, { status: 304, headers })
  }

  if (range === "unsatisfiable") {
    await object.body.cancel()
    headers.set("Content-Range", `bytes */${object.size}`)
    return refuse(416, headers)
  }

  describe(object, key, headers)

  if (range === undefined) {
    headers.set("Content-Length", String(object.size))
    if (request.method === "HEAD") {
      await object.body.cancel()
      return new Response(null, { headers })
    }
    return new Response(object.body, { headers })
  }

  const end = range.offset + range.length - 1
  headers.set("Content-Range", `bytes ${range.offset}-${end}/${object.size}`)
  headers.set("Content-Length", String(range.length))
  return new Response(object.body, { status: 206, headers })
}

/**
 * The R2 key named by the [[path]] segments, or undefined for none. The router
 * hands the segments over still percent-encoded, so each one is decoded first;
 * one that is empty, "." or "..", or hides a "/", names nothing.
 */
function objectKey(path: string | string[] | undefined): string | undefined {
  const segments: string[] = []
  for (const encoded of [path ?? []].flat()) {
    let segment: string
    try {
      segment = decodeURIComponent(encoded)
    } catch {
      return undefined
    }
    if (segment === "" || segment === "." || segment === ".." || segment.includes("/")) {
      return undefined
    }
    segments.push(segment)
  }
  return segments.length === 0 ? undefined : segments.join("/")
}

/**
 * The one byte range a GET asks for, resolved against the object: undefined to
 * send the whole object, "unsatisfiable" when the range starts past its end.
 */
function requestedRange(
  request: Request,
  object: R2Object,
): ByteRange | "unsatisfiable" | undefined {
  const header = request.headers.get("Range")
  if (request.method !== "GET" || header === null) return undefined

  // If-Range names the version the client already holds part of. Any other
  // version makes that part useless, so the client gets the whole object.
  const ifRange = request.headers.get("If-Range")
  if (ifRange !== null && ifRange !== object.httpEtag) return undefined

  // bytes=a-b, bytes=a- or bytes=-n. Anything else, several ranges included, is
  // ignored, which RFC 9110 allows: the client gets a plain 200.
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header)
  if (match === null) return undefined
  const [, first, last] = match
  const size = object.size

  if (first === "") {
    if (last === "") return undefined
    const length = Math.min(Number(last), size)
    return length === 0 ? "unsatisfiable" : { offset: size - length, length }
  }

  const offset = Number(first)
  if (last !== "" && Number(last) < offset) return undefined
  if (offset >= size) return "unsatisfiable"
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1)
  return { offset, length: end - offset + 1 }
}

/**
 * Whether the request's If-Match or If-Unmodified-Since fails for the object.
 * R2 only reports that some If-* header failed, and these two are the ones that
 * earn a 412 rather than a 304.
 */
function preconditionFailed(request: Request, object: R2Object): boolean {
  const ifMatch = request.headers.get("If-Match")
  if (ifMatch !== null) {
    const tags = ifMatch.split(",").map((tag) => tag.trim())
    return !tags.includes("*") && !tags.includes(object.httpEtag)
  }

  // If-Unmodified-Since counts only without If-Match. HTTP dates stop at whole
  // seconds, and one that does not parse is ignored (NaN compares false).
  const since = request.headers.get("If-Unmodified-Since")
  if (since === null) return false
  const uploaded = Math.floor(object.uploaded.getTime() / 1000) * 1000
  return uploaded > Date.parse(since)
}

/** The object's stored headers, for answers that carry or confirm it. */
function describe(object: R2Object, key: string, headers: Headers): void {
  object.writeHttpMetadata(headers)
  if (!headers.has("Content-Type")) {
    const type = TYPES.get(key.slice(key.lastIndexOf(".") + 1))
    if (type) headers.set("Content-Type", type)
  }
}

/** An empty error answer: not a video, and not to be kept by any cache. */
function refuse(status: number, headers: Headers): Response {
  headers.set("Cache-Control", "no-store")
  return new Response(null, { status, headers })
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 })
}
