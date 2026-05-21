const cheerio = require("cheerio");
const NodeCache = require("node-cache");
const { makeLogger } = require("./logger");

const log = makeLogger("prehraj");
const BASE = "https://prehraj.to";
const searchCache = new NodeCache({ stdTTL: 60 * 5 }); // 5 min
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// In-memory cookie jar shared across the warm container.
// We hydrate it once from a warmup GET on the homepage so we look
// like a returning visitor (PHPSESSID, perms, etc.).
const cookieJar = new Map();
let warmupPromise = null;

function buildHeaders(extraCookie) {
  const cookieStr = formatCookies(extraCookie);
  const headers = {
    "User-Agent": UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "cs-CZ,cs;q=0.9,sk;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    Referer: BASE + "/"
  };
  if (cookieStr) headers.Cookie = cookieStr;
  return headers;
}

function formatCookies(extra) {
  const parts = [];
  for (const [k, v] of cookieJar) parts.push(`${k}=${v}`);
  if (extra && typeof extra === "string") parts.push(extra);
  return parts.join("; ");
}

function ingestSetCookie(res) {
  // node fetch exposes Set-Cookie via res.headers.getSetCookie() (Node 20+)
  const raw =
    (res.headers.getSetCookie && res.headers.getSetCookie()) ||
    (res.headers.raw && res.headers.raw()["set-cookie"]) ||
    [];
  for (const line of raw) {
    const kv = line.split(";")[0];
    const eq = kv.indexOf("=");
    if (eq <= 0) continue;
    const name = kv.slice(0, eq).trim();
    const value = kv.slice(eq + 1).trim();
    if (name && value) cookieJar.set(name, value);
  }
}

async function warmup() {
  if (warmupPromise) return warmupPromise;
  warmupPromise = (async () => {
    try {
      log.info("warmup GET " + BASE + "/");
      const t0 = Date.now();
      const res = await fetch(BASE + "/", { headers: buildHeaders(), redirect: "follow" });
      ingestSetCookie(res);
      const ms = Date.now() - t0;
      log.info(`warmup ${res.status} (${ms}ms), cookies in jar: ${cookieJar.size}`);
      if (!res.ok) {
        log.warn("warmup non-2xx — site may be blocking this IP range");
      }
    } catch (err) {
      log.warn("warmup failed: " + err.message);
    }
  })();
  return warmupPromise;
}

/**
 * Search Přehraj.to for a query string. Returns array of result objects:
 *   { title, url, sizeBytes, durationSec, thumbnail }
 */
async function search(query, { token } = {}) {
  const cacheKey = `q:${query}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    log.debug(`cache hit "${query}" (${cached.length} results)`);
    return cached;
  }

  await warmup();

  const url = `${BASE}/hledej/${encodeURIComponent(query)}`;
  log.debug("GET", url);
  const t0 = Date.now();
  const res = await fetch(url, { headers: buildHeaders(token), redirect: "follow" });
  ingestSetCookie(res);
  const ms = Date.now() - t0;
  if (!res.ok) {
    const body = await safePreview(res);
    log.warn(
      `search ${res.status} (${ms}ms) "${query}" ` +
      `server=${res.headers.get("server") || "?"} ` +
      `cf-ray=${res.headers.get("cf-ray") || "-"} ` +
      `cf-mitigated=${res.headers.get("cf-mitigated") || "-"} ` +
      `content-type=${res.headers.get("content-type") || "?"} ` +
      `— body preview: ${body}`
    );
    if (res.status === 404) return [];
    throw new Error(`Prehraj search ${res.status} for ${query}`);
  }
  const html = await res.text();
  log.debug(`search "${query}" ${res.status} (${ms}ms, ${html.length} bytes)`);
  const results = parseSearchResults(html);
  if (results.length === 0) {
    log.warn(`search "${query}" returned 0 results — selectors may need updating`);
  }
  searchCache.set(cacheKey, results);
  return results;
}

async function safePreview(res) {
  try {
    const txt = await res.text();
    return txt.slice(0, 300).replace(/\s+/g, " ");
  } catch {
    return "(no body)";
  }
}

function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const out = [];

  // Each result is an <a class="video --link"> with nested elements.
  $("a.video--link, a.video, a[class*='video']").each((_i, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href || !href.startsWith("/")) return;

    const title =
      $el.find(".video__title, h3").first().text().trim() ||
      $el.attr("title") ||
      "";
    const sizeText = $el.find(".video__tag--size, .video__size").first().text().trim();
    const timeText = $el.find(".video__tag--time, .video__time").first().text().trim();
    const thumb = $el.find("img").attr("src") || "";

    if (!title) return;

    out.push({
      title,
      url: BASE + href,
      sizeBytes: parseSize(sizeText),
      durationSec: parseDuration(timeText),
      thumbnail: thumb
    });
  });

  // Deduplicate by URL
  const seen = new Set();
  return out.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

function parseSize(text) {
  if (!text) return 0;
  const m = text.replace(",", ".").match(/([\d.]+)\s*(KB|MB|GB|TB)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit] || 1;
  return Math.round(n * mult);
}

function parseDuration(text) {
  if (!text) return 0;
  const parts = text.split(":").map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return 0;
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return s;
}

/**
 * Fetch a video detail page and extract direct stream URLs.
 * Returns array of { url, label, height } sorted by quality desc.
 *
 * Note: these mp4 URLs are short-lived (signed). Always resolve at request time.
 */
async function getStreams(pageUrl, { token } = {}) {
  await warmup();
  log.debug("GET", pageUrl);
  const t0 = Date.now();
  const res = await fetch(pageUrl, { headers: buildHeaders(token), redirect: "follow" });
  ingestSetCookie(res);
  const ms = Date.now() - t0;
  if (!res.ok) {
    const body = await safePreview(res);
    log.warn(`page ${res.status} (${ms}ms) ${pageUrl} — body preview: ${body}`);
    throw new Error(`Prehraj page ${res.status} for ${pageUrl}`);
  }
  const html = await res.text();
  log.debug(`page ${res.status} (${ms}ms, ${html.length} bytes) ${pageUrl}`);
  const sources = extractSources(html);
  if (sources.length === 0) {
    log.warn(`no sources extracted from ${pageUrl} — page format may have changed`);
  }
  return sources;
}

function extractSources(html) {
  // The video page embeds a JWPlayer/VideoJS `var sources = [ { file: "...", label: "1080p" } ]`
  // (or `sources: [...]`). Plus a <meta itemprop="height"> hint we can fall back on.
  const sources = [];

  // Detect a "natural" height hint from itemprop metadata
  let metaHeight = 0;
  const mh = html.match(/itemprop=["']height["']\s+content=["'](\d+)["']/i);
  if (mh) metaHeight = parseInt(mh[1], 10);

  // Pattern 1: `var sources = [ { file: "...", label: '1080p' }, ... ]`
  // or `sources: [ ... ]`. Iterate object literals individually with regex,
  // since the full array uses unquoted keys + single quotes + trailing commas.
  const arrayMatch =
    html.match(/var\s+sources\s*=\s*(\[[\s\S]*?\])\s*;/) ||
    html.match(/sources\s*:\s*(\[[\s\S]*?\])/);

  if (arrayMatch) {
    const arrStr = arrayMatch[1];
    const objRe = /\{([^{}]*)\}/g;
    let m;
    while ((m = objRe.exec(arrStr))) {
      const body = m[1];
      const fileM = body.match(/(?:file|src)\s*:\s*['"]([^'"]+)['"]/);
      const labelM = body.match(/label\s*:\s*['"]([^'"]+)['"]/);
      if (fileM) sources.push(toSource(fileM[1], labelM ? labelM[1] : undefined));
    }
  }

  if (sources.length === 0) {
    // Fallback: <source src="..." label="1080p" />
    const $ = cheerio.load(html);
    $("video source, source").each((_i, el) => {
      const src = $(el).attr("src");
      const label = $(el).attr("label") || $(el).attr("data-label");
      if (src) sources.push(toSource(src, label));
    });
  }

  if (sources.length === 0) {
    // Last-resort: bare .mp4 URLs in the document
    const re = /['"](https?:\/\/[^'"]+\.mp4[^'"]*)['"]/g;
    let m;
    while ((m = re.exec(html))) sources.push(toSource(m[1]));
  }

  // If no per-source labels were available but we have a meta height,
  // apply it to the (assumed primary) source.
  if (metaHeight && sources.length && sources.every((s) => !s.height)) {
    sources[0] = { ...sources[0], height: metaHeight, label: `${metaHeight}p` };
  }

  // Deduplicate by URL, sort highest quality first
  const seen = new Set();
  return sources
    .filter((s) => {
      if (!s.url || seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    })
    .sort((a, b) => b.height - a.height);
}

function toSource(url, label) {
  const height = parseHeight(label) || guessHeightFromUrl(url);
  return { url, label: label || (height ? `${height}p` : "video"), height };
}

function parseHeight(label) {
  if (!label) return 0;
  const m = String(label).match(/(\d{3,4})\s*p?/i);
  return m ? parseInt(m[1], 10) : 0;
}

function guessHeightFromUrl(url) {
  const m = url.match(/(\d{3,4})p/i);
  return m ? parseInt(m[1], 10) : 0;
}

module.exports = { search, getStreams, parseSearchResults, extractSources };
