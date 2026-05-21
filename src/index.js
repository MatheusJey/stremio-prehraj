const http = require("http");
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

const server = http.createServer(async (req, res) => {
  // Custom debug endpoint: /debug/stream/<type>/<id>.json
  // Returns the same streams as the normal endpoint plus a `diag` object
  // with every intermediate step (queries, search results, filter rejects,
  // extracted sources). Use it from your browser to see why nothing matched.
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

  // Log every Stremio call
  if (req.url && req.url.includes("/stream/")) {
    log.info(`${req.method} ${req.url}`);
  }
  router(req, res, function () {
    res.statusCode = 404;
    res.end();
  });
});

const PORT = Number(process.env.PORT || 7860);
server.listen(PORT, () => {
  log.info(`Stremio Přehraj.to addon listening on http://127.0.0.1:${PORT}`);
  log.info(`Manifest URL : http://127.0.0.1:${PORT}/manifest.json`);
  log.info(`Install URL  : stremio://127.0.0.1:${PORT}/manifest.json`);
  log.info(`Debug URL    : http://127.0.0.1:${PORT}/debug/stream/series/tt0898266:6:19.json`);
  log.info(`LOG_LEVEL    : ${(process.env.LOG_LEVEL || "debug").toLowerCase()}`);
});
