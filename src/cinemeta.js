const NodeCache = require("node-cache");

const cache = new NodeCache({ stdTTL: 60 * 60 * 24 }); // 24h
const BASE = "https://v3-cinemeta.strem.io";

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "stremio-prehraj/0.1" } });
  if (!res.ok) throw new Error(`Cinemeta ${res.status} for ${url}`);
  return res.json();
}

async function getMeta(type, imdbId) {
  const key = `${type}:${imdbId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const url = `${BASE}/meta/${type}/${imdbId}.json`;
  const data = await fetchJson(url);
  if (!data || !data.meta) throw new Error(`No meta for ${imdbId}`);
  cache.set(key, data.meta);
  return data.meta;
}

/**
 * Resolve a Stremio stream id to a query plan.
 * Movie id: "tt1234567"
 * Series id: "tt1234567:6:19" (imdb:season:episode)
 */
async function resolveQuery(type, id) {
  if (type === "movie") {
    const meta = await getMeta("movie", id);
    const year = meta.year || (meta.released ? new Date(meta.released).getFullYear() : "");
    return {
      kind: "movie",
      title: meta.name,
      year: year ? String(year) : "",
      queries: buildMovieQueries(meta.name, year)
    };
  }

  if (type === "series") {
    const [imdb, sRaw, eRaw] = id.split(":");
    const season = Number(sRaw);
    const episode = Number(eRaw);
    if (!season || !episode) throw new Error(`Bad series id ${id}`);
    const meta = await getMeta("series", imdb);
    return {
      kind: "series",
      title: meta.name,
      season,
      episode,
      queries: buildSeriesQueries(meta.name, season, episode)
    };
  }

  throw new Error(`Unsupported type ${type}`);
}

function buildMovieQueries(title, year) {
  const base = [title];
  if (year) base.push(`${title} ${year}`);
  return dedupe(base);
}

function buildSeriesQueries(title, season, episode) {
  const sxxexx = `S${pad(season)}E${pad(episode)}`;
  const lowerCz = `${season}x${pad(episode)}`;
  return dedupe([
    `${title} ${sxxexx}`,
    `${title} ${lowerCz}`,
    `${title} ${season}. serie ${episode}. dil`,
    `${title} ${season}. série ${episode}. díl`
  ]);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function dedupe(arr) {
  return [...new Set(arr.map((x) => x.trim()).filter(Boolean))];
}

module.exports = { resolveQuery, getMeta };
