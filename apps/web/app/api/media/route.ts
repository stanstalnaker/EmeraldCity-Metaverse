/**
 * GET /api/media?url=…: images and video for in-world screens, re-served from this origin with CORS
 * so the 3D client can use them as textures (WebGL can't use cross-origin images without CORS).
 *
 * Only https URLs on the allow-listed hosts are fetched, redirects are not followed, only image and
 * video responses are passed through, and size is capped: this is not a general proxy.
 */
const ALLOWED_HOSTS = [
  /^i\.ytimg\.com$/, /^img\.youtube\.com$/,
  /^([a-z0-9-]+\.)*hubculture\.(com|city)$/,
  /^[a-z0-9.-]+\.s3[a-z0-9.-]*\.amazonaws\.com$/, /^s3[a-z0-9.-]*\.amazonaws\.com$/,
  ...(process.env.MEDIA_PROXY_EXTRA_HOSTS ?? "").split(",").filter(Boolean).map((h) => new RegExp(`^${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)),
];
const MAX_BYTES = 25 * 1024 * 1024;

export async function GET(req: Request) {
  const cors = { "Access-Control-Allow-Origin": process.env.CITY3D_ORIGIN ?? "*" };
  let target: URL;
  try {
    target = new URL(new URL(req.url).searchParams.get("url") ?? "");
  } catch {
    return new Response("bad url", { status: 400, headers: cors });
  }
  if (target.protocol !== "https:" || target.username || target.password || target.port || !ALLOWED_HOSTS.some((h) => h.test(target.hostname))) {
    return new Response("host not allowed", { status: 403, headers: cors });
  }
  const upstream = await fetch(target, { redirect: "manual", headers: { Accept: "image/*,video/*" } }).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) return new Response("upstream failed", { status: 502, headers: cors });
  const type = upstream.headers.get("content-type") ?? "";
  if (!/^(image|video)\//.test(type)) return new Response("not media", { status: 415, headers: cors });
  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return new Response("too large", { status: 413, headers: cors });
  return new Response(upstream.body, {
    headers: { ...cors, "Content-Type": type, "Cache-Control": "public, max-age=3600", ...(length ? { "Content-Length": String(length) } : {}) },
  });
}
