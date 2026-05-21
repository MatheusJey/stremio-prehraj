/**
 * Heuristic analyzer for Přehraj.to release titles.
 * Best-effort — uploaders use wildly inconsistent naming.
 *
 * Returns:
 *   {
 *     height:   number | 0,            // 2160 / 1080 / 720 / ...
 *     source:   "BluRay" | "WEB" | "HDTV" | "DVD" | "CAM" | "",
 *     codec:    "HEVC" | "H264" | "",
 *     hdr:      "HDR" | "DV" | "",
 *     audio:    ["CZ-dab"|"SK-dab"|"EN"|"orig", ...]    // ordered, deduped
 *     subs:     ["CZ","SK","EN", ...]
 *   }
 */
function analyzeTitle(rawTitle) {
  const title = String(rawTitle || "");
  const t = title.toLowerCase();
  const norm = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); // strip diacritics

  return {
    height: parseHeight(norm),
    source: parseSource(norm),
    codec: parseCodec(norm),
    hdr: parseHdr(norm),
    audio: parseAudio(norm),
    subs: parseSubs(norm)
  };
}

function parseHeight(t) {
  // Common explicit tokens
  const m = t.match(/\b(2160|1440|1080|720|576|480|360)\s*p\b/);
  if (m) return parseInt(m[1], 10);
  // "FullHD" / "HD" without numbers
  if (/\bfull\s*hd\b/.test(t)) return 1080;
  if (/\buhd|4k\b/.test(t)) return 2160;
  if (/\bhd\b/.test(t)) return 720;
  return 0;
}

function parseSource(t) {
  if (/\b(bluray|blu-ray|brrip|bdrip|bdremux|remux)\b/.test(t)) return "BluRay";
  if (/\b(web-?dl|webrip|web)\b/.test(t)) return "WEB";
  if (/\bhdtv\b/.test(t)) return "HDTV";
  if (/\b(dvdrip|dvd)\b/.test(t)) return "DVD";
  if (/\b(camrip|hdcam|telesync|\bts\b|\bcam\b)\b/.test(t)) return "CAM";
  return "";
}

function parseCodec(t) {
  if (/\b(hevc|x265|h\.?265)\b/.test(t)) return "HEVC";
  if (/\b(x264|h\.?264|avc)\b/.test(t)) return "H264";
  return "";
}

function parseHdr(t) {
  if (/\bdolby\s*vision|\bdv\b/.test(t)) return "DV";
  if (/\bhdr10\+?|\bhdr\b/.test(t)) return "HDR";
  return "";
}

function parseAudio(t) {
  const out = [];

  // Czech dub: cz.dab, czdab, cesky dabing, dabing, dabovano, "CZ" suffix-ish
  const czDub =
    /\b(cz|cesk[yae]?|c[sz]\.?)\s*[._-]?\s*(dab|dabing|dabovan[aoy]?)/.test(t) ||
    /\bczdab\b/.test(t) ||
    /\bdabing\b/.test(t) ||
    /\bdabovan[oy]?\b/.test(t) ||
    /\bcesky\s+dab/.test(t);
  if (czDub) out.push("CZ-dab");

  // Slovak dub
  const skDub =
    /\b(sk|slov(ak|en)\w*)\s*[._-]?\s*(dab|dabing|dabovan[aoy]?)/.test(t) ||
    /\bskdab\b/.test(t);
  if (skDub) out.push("SK-dab");

  // If a CZ/SK release tag appears WITHOUT explicit "tit"/"sub" and no dub tag,
  // a bare "CZ"/"SK" near end/start of release commonly means dub on prehraj.
  if (!czDub && !skDub) {
    const isBareCz =
      /(^|[\s._-])cz([\s._-]|$)/.test(t) && !hasCzSubsHint(t);
    if (isBareCz) out.push("CZ-dab?");
  }

  // English / original — only flag if explicitly mentioned
  if (/\b(eng|english)\b/.test(t)) out.push("EN");

  return dedupe(out);
}

function parseSubs(t) {
  const out = [];
  // Look for any compound lang prefix before "tit", e.g. "cztit", "czsk-tit", "skcz_tit"
  const titMatch = t.match(/\b([a-z]{2,8})[\s._-]?tit\w*/);
  if (titMatch) {
    const prefix = titMatch[1];
    if (/cz|cs|cesk/.test(prefix)) out.push("CZ");
    if (/sk|slov/.test(prefix)) out.push("SK");
    if (/en|eng/.test(prefix)) out.push("EN");
  }
  if (/\bcesk[ye]?\s*titulky/.test(t)) out.push("CZ");
  if (/\bslov(ak|en)\w*\s*titulky/.test(t)) out.push("SK");
  if (/\benglish\s*subs?/.test(t)) out.push("EN");
  // generic "titulky" with no language hint
  if (out.length === 0 && /\btitulky|\btitles\b|\bsubs\b/.test(t)) out.push("?");
  return dedupe(out);
}

function hasCzSubsHint(t) {
  return /\b(cz|cs|cesk|czsk|skcz)[\s._-]?tit/.test(t) || /\bcesk[ye]?\s*titulky/.test(t);
}

function dedupe(arr) {
  return [...new Set(arr)];
}

/**
 * Compact one-line summary like "1080p BluRay H264 • CZ-dab • subs CZ"
 */
function summarize(meta) {
  const tech = [
    meta.height ? `${meta.height}p` : "",
    meta.source,
    meta.codec,
    meta.hdr
  ].filter(Boolean).join(" ");

  const audio = meta.audio.length ? meta.audio.join("/") : "";
  const subs = meta.subs.length ? `subs ${meta.subs.join("/")}` : "";

  return [tech, audio, subs].filter(Boolean).join(" • ");
}

module.exports = { analyzeTitle, summarize };
