# stremio-prehraj

Stremio addon that returns direct HTTP(S) video streams sourced from **Přehraj.to** search results.

Architecture mirrors Torrentio but instead of torrent hashes it returns plain `https://.../*.mp4` URLs.

```
Stremio opens an episode
        ↓
Addon receives IMDb ID + SxxExx
        ↓
Cinemeta resolves title (no API key needed)
        ↓
Addon searches https://prehraj.to/hledej/<query>
        ↓
Addon opens each result page and extracts direct mp4 sources
        ↓
Addon returns streams (1080p, 720p, 480p, …)
```

## Install / Run

```bash
npm install
npm start
```

Addon serves on http://127.0.0.1:7000

Install in Stremio:

- Open Stremio → Add-ons → "Add add-on" → paste `http://127.0.0.1:7000/manifest.json`
- Or open `stremio://127.0.0.1:7000/manifest.json`

## Configuration

When installing you can optionally supply:

| Field             | Purpose                                                            |
|-------------------|--------------------------------------------------------------------|
| `prehraj_token`   | Your Přehraj.to **session cookie** (string like `PHPSESSID=...`). Required for premium quality / unlimited playback. Without it you'll only get free-tier streams. |
| `min_size_mb`     | Filter out tiny results (default 100 MB).                          |
| `max_results`     | Cap how many candidate pages are resolved (default 20).            |

### Getting a session cookie

1. Log in to https://prehraj.to in a desktop browser.
2. DevTools → Application → Cookies → copy the full `Cookie` header value (e.g. `PHPSESSID=abc; remember=def`).
3. Paste it into the addon configuration page.

The cookie is only stored client-side in your Stremio install and is forwarded to Přehraj.to via `proxyHeaders` on each request — direct mp4 URLs are not cached because they are signed and short-lived.

## Files

- `src/manifest.js` – Stremio manifest definition
- `src/cinemeta.js` – IMDb → title/year/season-episode resolution via Cinemeta
- `src/prehrajto.js` – Search + video-page parsing (cheerio)
- `src/handler.js` – Stream resource implementation, filtering and ranking
- `src/index.js` – HTTP entry point

## Caveats

- **Legality**: This addon is a thin client over Přehraj.to. You are responsible for only accessing content you have rights to.
- **HTML scraping**: If Přehraj.to changes its markup, parsing in `prehrajto.js` will need updating (`parseSearchResults`, `extractSources`).
- **Signed URLs**: `*.mp4` links contain `token`, `expires`, `signature` — never cache them. The addon always re-resolves at stream-time.
- **Headers**: Stremio's player will be told (via `behaviorHints.proxyHeaders`) to send `Referer: prehraj.to` and (if configured) your cookie.

## Deploying to a public host

`stremio-addon-sdk` listens on the port set in `process.env.PORT`, so it works out of the box on Beamup, Fly, Railway, Render, etc.

```bash
PORT=7000 npm start
```
