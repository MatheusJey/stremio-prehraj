const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const manifest = require("./manifest");
const { streamHandler } = require("./handler");

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async (args) => {
  try {
    return await streamHandler(args);
  } catch (err) {
    console.error("[prehraj] handler error", err);
    return { streams: [] };
  }
});

const PORT = Number(process.env.PORT || 7000);
serveHTTP(builder.getInterface(), { port: PORT });

console.log(`Stremio Přehraj.to addon listening on http://127.0.0.1:${PORT}`);
console.log(`Manifest URL: http://127.0.0.1:${PORT}/manifest.json`);
console.log(`Install URL : stremio://127.0.0.1:${PORT}/manifest.json`);
