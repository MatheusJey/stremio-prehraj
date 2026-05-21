const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const ENV_LEVEL = (process.env.LOG_LEVEL || "debug").toLowerCase();
const THRESHOLD = LEVELS[ENV_LEVEL] ?? LEVELS.debug;

function ts() {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function fmt(parts) {
  return parts
    .map((p) => {
      if (p === undefined) return "";
      if (p === null) return "null";
      if (typeof p === "string") return p;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .filter(Boolean)
    .join(" ");
}

function makeLogger(scope) {
  function log(level, ...parts) {
    if (LEVELS[level] < THRESHOLD) return;
    const line = `${ts()} [${level.toUpperCase()}] [${scope}] ${fmt(parts)}`;
    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  }
  return {
    debug: (...a) => log("debug", ...a),
    info: (...a) => log("info", ...a),
    warn: (...a) => log("warn", ...a),
    error: (...a) => log("error", ...a),
    child: (sub) => makeLogger(`${scope}:${sub}`)
  };
}

let reqCounter = 0;
function nextReqId() {
  reqCounter = (reqCounter + 1) % 100000;
  return `r${reqCounter.toString().padStart(5, "0")}`;
}

module.exports = { makeLogger, nextReqId };
