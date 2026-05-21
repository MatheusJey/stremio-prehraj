const { resolveQuery } = require("./cinemeta");
const { search, getStreams } = require("./prehrajto");
const { analyzeTitle, summarize } = require("./analyze");
const { makeLogger, nextReqId } = require("./logger");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "una", "los", "las",
  "der", "die", "das", "ein", "eine"
]);

async function streamHandler({ type, id, config }, options = {}) {
  const cfg = normalizeConfig(config);
  const reqId = nextReqId();
  const log = makeLogger(`handler ${reqId}`);
  const diag = { reqId, type, id, config: { ...cfg, token: cfg.token ? "(set)" : "" }, steps: [] };

  log.info("=== stream request ===", { type, id });
  log.debug("config", diag.config);

  let plan;
  try {
    plan = await resolveQuery(type, id);
  } catch (err) {
    log.error("meta resolve failed", err.message);
    diag.error = `meta: ${err.message}`;
    return options.diag ? { streams: [], diag } : { streams: [] };
  }
  log.info("resolved title:", plan.title, plan.kind === "series" ? `S${plan.season}E${plan.episode}` : `(${plan.year || "?"})`);
  log.debug("search queries:", plan.queries);
  diag.plan = plan;

  // Search with each query, accumulate candidates
  const seen = new Set();
  const candidates = [];
  for (const q of plan.queries) {
    let results = [];
    try {
      results = await search(q, { token: cfg.token });
    } catch (err) {
      log.warn("search failed", q, err.message);
      diag.steps.push({ query: q, error: err.message });
      continue;
    }
    log.info(`search "${q}" -> ${results.length} results`);
    if (results.length) {
      log.debug("  top 5 titles:", results.slice(0, 5).map((r) => r.title));
    }
    diag.steps.push({
      query: q,
      total: results.length,
      sample: results.slice(0, 10).map((r) => ({
        title: r.title,
        url: r.url,
        sizeBytes: r.sizeBytes,
        durationSec: r.durationSec
      }))
    });
    for (const r of results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      candidates.push(r);
    }
    if (candidates.length >= cfg.maxResults * 2) {
      log.debug("enough candidates collected, stopping search loop");
      break;
    }
  }

  log.info(`accumulated ${candidates.length} unique candidates`);

  // Filter by size and relevance (must mention title tokens + season/episode marker for series)
  const filterStats = { sizeRejected: 0, relevanceRejected: [] };
  const filtered = candidates.filter((c) => {
    if (c.sizeBytes > 0 && c.sizeBytes < cfg.minSizeBytes) {
      filterStats.sizeRejected += 1;
      return false;
    }
    const reason = relevanceReason(c.title, plan);
    if (reason) {
      if (filterStats.relevanceRejected.length < 10) {
        filterStats.relevanceRejected.push({ title: c.title, reason });
      }
      return false;
    }
    return true;
  }).slice(0, cfg.maxResults);

  log.info(`filtered to ${filtered.length} (size-rejected: ${filterStats.sizeRejected}, relevance-rejected: ${candidates.length - filtered.length - filterStats.sizeRejected})`);
  if (filterStats.relevanceRejected.length) {
    log.debug("rejected by relevance (sample):", filterStats.relevanceRejected);
  }
  diag.filterStats = filterStats;
  diag.filtered = filtered.map((c) => ({ title: c.title, url: c.url, sizeBytes: c.sizeBytes }));

  // Resolve each candidate to direct stream URLs in parallel
  const streams = [];
  const extractDiag = [];
  await Promise.all(
    filtered.map(async (c) => {
      try {
        const sources = await getStreams(c.url, { token: cfg.token });
        log.debug(`extract ${c.url} -> ${sources.length} source(s)`, sources.map((s) => s.label || "?"));
        extractDiag.push({ url: c.url, sources: sources.length, labels: sources.map((s) => s.label) });
        for (const s of sources) {
          streams.push(buildStream(c, s, cfg.token));
        }
      } catch (err) {
        log.warn("extract failed", c.url, err.message);
        extractDiag.push({ url: c.url, error: err.message });
      }
    })
  );
  diag.extract = extractDiag;

  // Sort: prefer CZ audio/subs first, then higher resolution, then larger file size
  streams.sort((a, b) =>
    (b._audioRank - a._audioRank) ||
    (b._height - a._height) ||
    (b._size - a._size)
  );

  log.info(`=== returning ${streams.length} stream(s) ===`);
  diag.streamCount = streams.length;

  const out = { streams: streams.map(stripInternal) };
  return options.diag ? { ...out, diag } : out;
}

function buildStream(candidate, source, token) {
  const meta = analyzeTitle(candidate.title);

  // Best-available height: player label > release title hint
  const height = source.height || meta.height || 0;
  const playerLabel = source.label || (height ? `${height}p` : "");

  // Tech summary (uses release-title info: source, codec, audio, subs)
  const techSummary = summarize({ ...meta, height });

  const sizeGB = candidate.sizeBytes ? (candidate.sizeBytes / 1024 ** 3).toFixed(2) : null;
  const sizeLabel = sizeGB ? `${sizeGB} GB` : "";

  // Compact tag for the stream name (the bold line in Stremio)
  const audioTag =
    meta.audio.includes("CZ-dab") ? "CZ dab"
    : meta.audio.includes("SK-dab") ? "SK dab"
    : meta.audio.includes("CZ-dab?") ? "CZ?"
    : meta.subs.includes("CZ") ? "CZ tit"
    : meta.subs.includes("SK") ? "SK tit"
    : meta.audio.includes("EN") ? "EN"
    : "";

  const nameParts = ["Přehraj.to"];
  if (playerLabel) nameParts.push(playerLabel);
  if (audioTag) nameParts.push(audioTag);

  const description = [
    candidate.title,
    [techSummary, sizeLabel].filter(Boolean).join(" • ")
  ].filter(Boolean).join("\n");

  const stream = {
    name: nameParts.join(" "),
    description,
    url: source.url,
    behaviorHints: {
      notWebReady: false,
      bingeGroup: `prehrajto-${playerLabel || "default"}`,
      proxyHeaders: {
        request: {
          "User-Agent": UA,
          Referer: "https://prehraj.to/"
        }
      }
    },
    _height: height,
    _size: candidate.sizeBytes || 0,
    _audioRank: audioRank(meta)
  };

  if (token) {
    stream.behaviorHints.proxyHeaders.request.Cookie = token;
  }

  return stream;
}

// Sort priority: prefer CZ dub > CZ subs > SK dub > SK subs > EN > unknown.
function audioRank(meta) {
  if (meta.audio.includes("CZ-dab")) return 6;
  if (meta.subs.includes("CZ")) return 5;
  if (meta.audio.includes("CZ-dab?")) return 4;
  if (meta.audio.includes("SK-dab")) return 3;
  if (meta.subs.includes("SK")) return 2;
  if (meta.audio.includes("EN")) return 1;
  return 0;
}

function stripInternal(stream) {
  const { _height, _size, _audioRank, ...rest } = stream;
  return rest;
}

// Returns null if relevant, or a string explaining why not.
function relevanceReason(title, plan) {
  const t = normalize(title);
  const wanted = normalize(plan.title);
  if (!wanted) return null;

  const tokens = wanted
    .split(" ")
    .filter((x) => x.length > 2 && !STOPWORDS.has(x));

  // require >=70% of significant tokens to appear; also at least 1 token
  if (tokens.length === 0) return null;
  const matched = tokens.filter((tok) => t.includes(tok));
  if (matched.length / tokens.length < 0.7) {
    return `title mismatch (matched ${matched.length}/${tokens.length}: [${matched.join(",")}] vs [${tokens.join(",")}])`;
  }

  if (plan.kind === "series") {
    const sxxexx = `s${pad(plan.season)}e${pad(plan.episode)}`;
    const alt = `${plan.season}x${pad(plan.episode)}`;
    const altSingle = `${plan.season}x${plan.episode}`;
    if (!t.includes(sxxexx) && !t.includes(alt) && !t.includes(altSingle)) {
      return `no episode marker (looking for ${sxxexx} / ${alt})`;
    }
  }
  return null;
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
