const { resolveQuery } = require("./cinemeta");
const { search, getStreams } = require("./prehrajto");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function streamHandler({ type, id, config }) {
  const cfg = normalizeConfig(config);

  let plan;
  try {
    plan = await resolveQuery(type, id);
  } catch (err) {
    console.error("[prehraj] meta resolve failed", err.message);
    return { streams: [] };
  }

  // Search with each query, accumulate candidates
  const seen = new Set();
  const candidates = [];
  for (const q of plan.queries) {
    let results = [];
    try {
      results = await search(q, { token: cfg.token });
    } catch (err) {
      console.error("[prehraj] search failed", q, err.message);
      continue;
    }
    for (const r of results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      candidates.push(r);
    }
    if (candidates.length >= cfg.maxResults * 2) break;
  }

  // Filter by size and relevance (must mention title tokens + season/episode marker for series)
  const filtered = candidates
    .filter((c) => c.sizeBytes === 0 || c.sizeBytes >= cfg.minSizeBytes)
    .filter((c) => isRelevant(c.title, plan))
    .slice(0, cfg.maxResults);

  // Resolve each candidate to direct stream URLs in parallel
  const streams = [];
  await Promise.all(
    filtered.map(async (c) => {
      try {
        const sources = await getStreams(c.url, { token: cfg.token });
        for (const s of sources) {
          streams.push(buildStream(c, s, cfg.token));
        }
      } catch (err) {
        console.error("[prehraj] extract failed", c.url, err.message);
      }
    })
  );

  // Sort: prefer higher resolution, then larger file size
  streams.sort((a, b) => (b._height - a._height) || (b._size - a._size));

  return { streams: streams.map(stripInternal) };
}

function buildStream(candidate, source, token) {
  const sizeGB = candidate.sizeBytes ? (candidate.sizeBytes / 1024 ** 3).toFixed(2) : null;
  const sizeLabel = sizeGB ? `${sizeGB} GB` : "";
  const qualityLabel = source.label || (source.height ? `${source.height}p` : "");

  const description = [candidate.title, [qualityLabel, sizeLabel].filter(Boolean).join(" • ")]
    .filter(Boolean)
    .join("\n");

  const stream = {
    name: `Přehraj.to${qualityLabel ? " " + qualityLabel : ""}`,
    description,
    url: source.url,
    behaviorHints: {
      notWebReady: false,
      bingeGroup: `prehrajto-${qualityLabel || "default"}`,
      proxyHeaders: {
        request: {
          "User-Agent": UA,
          Referer: "https://prehraj.to/"
        }
      }
    },
    _height: source.height || 0,
    _size: candidate.sizeBytes || 0
  };

  if (token) {
    stream.behaviorHints.proxyHeaders.request.Cookie = token;
  }

  return stream;
}

function stripInternal(stream) {
  const { _height, _size, ...rest } = stream;
  return rest;
}

function isRelevant(title, plan) {
  const t = normalize(title);
  const wanted = normalize(plan.title);
  if (!wanted) return true;
  // every significant token of the wanted title must appear
  const tokens = wanted.split(" ").filter((x) => x.length > 2);
  for (const tok of tokens) {
    if (!t.includes(tok)) return false;
  }
  if (plan.kind === "series") {
    const sxxexx = `s${pad(plan.season)}e${pad(plan.episode)}`;
    const alt = `${plan.season}x${pad(plan.episode)}`;
    if (!t.includes(sxxexx) && !t.includes(alt)) return false;
  }
  return true;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeConfig(config) {
  const c = config || {};
  return {
    token: c.prehraj_token ? String(c.prehraj_token).trim() : "",
    minSizeBytes: Math.max(0, Number(c.min_size_mb ?? 100)) * 1024 * 1024,
    maxResults: Math.max(1, Math.min(50, Number(c.max_results ?? 20)))
  };
}

module.exports = { streamHandler };
