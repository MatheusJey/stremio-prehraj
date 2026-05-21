const http = require("http");
const { handleRequest } = require("./app");
const { makeLogger } = require("./logger");

const log = makeLogger("server");
const PORT = Number(process.env.PORT || 7860);

http.createServer(handleRequest).listen(PORT, () => {
  log.info(`Stremio Přehraj.to addon listening on http://127.0.0.1:${PORT}`);
  log.info(`Manifest URL : http://127.0.0.1:${PORT}/manifest.json`);
  log.info(`Install URL  : stremio://127.0.0.1:${PORT}/manifest.json`);
  log.info(`Debug URL    : http://127.0.0.1:${PORT}/debug/stream/series/tt0898266:6:19.json`);
  log.info(`LOG_LEVEL    : ${(process.env.LOG_LEVEL || "debug").toLowerCase()}`);
});
