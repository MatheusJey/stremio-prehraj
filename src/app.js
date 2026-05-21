const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const manifest = require("./manifest");
const { streamHandler } = require("./handler");
const { makeLogger } = require("./logger");

const log = makeLogger("server");

const builder = new addonBuilder(manifest);
builder.defineStreamHandler(async (args) => {
  try {
    return await streamHandler(args);
  } catch (err) {
    log.error("handler error", err.stack || err.message);
    return { streams: [] };
  }
});

const router = getRouter(builder.getInterface());

/**
 * Universal Node HTTP handler — works for `http.createServer` (local)
 * and Vercel serverless `(req, res)` Node functions.
 */
async function handleRequest(req, res) {
  // Custom debug endpoint: /debug/stream/<type>/<id>.json
  const dbg = req.url && req.url.match(/^\/debug\/stream\/([^/]+)\/(.+)\.json/);
  if (dbg) {
    const type = decodeURIComponent(dbg[1]);
    const id = decodeURIComponent(dbg[2]);
    log.info(`DEBUG request type=${type} id=${id}`);
    try {
      const result = await streamHandler({ type, id, config: {} }, { diag: true });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify(result, null, 2));
    } catch (err) {
      log.error("debug handler error", err.stack || err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Friendly landing page for "/"
  if (req.url === "/" || req.url === "") {
    res.writeHead(302, { Location: "/manifest.json" });
    res.end();
    return;
  }

  if (req.url && req.url.includes("/stream/")) {
    log.info(`${req.method} ${req.url}`);
  }

  router(req, res, function () {
    res.statusCode = 404;
    res.end();
  });
}

module.exports = { handleRequest, manifest, router };
