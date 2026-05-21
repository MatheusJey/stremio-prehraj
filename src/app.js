const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const landingTemplate = require("stremio-addon-sdk/src/landingTemplate");
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

const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);
const landingHTML = landingTemplate(addonInterface.manifest);

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

  // Landing / configuration page (served by Stremio's built-in template)
  const path = (req.url || "").split("?")[0];
  if (path === "/" || path === "" || path === "/configure") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(landingHTML);
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
