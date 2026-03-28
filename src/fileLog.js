import fs from "fs";
import path from "path";

const logDir = process.env.LOG_DIR || "logs";
const accessPath = process.env.LOG_ACCESS_PATH || path.join(logDir, "access.log");
const eventsPath = process.env.LOG_EVENTS_PATH || path.join(logDir, "events.log");

export function isFileLoggingEnabled() {
  return process.env.LOG_TO_FILE !== "false" && process.env.LOG_TO_FILE !== "0";
}

function ensureDir() {
  fs.mkdirSync(logDir, { recursive: true });
}

/** Writable stream for morgan (HTTP access lines). */
export function createAccessLogStream() {
  if (!isFileLoggingEnabled()) return null;
  try {
    ensureDir();
    return fs.createWriteStream(accessPath, { flags: "a" });
  } catch (e) {
    console.error("[fileLog] access stream failed", e.message);
    return null;
  }
}

/**
 * One JSON line per event (webhook errors, FCM summary, etc.).
 * @param {"info"|"warn"|"error"} level
 * @param {string} event
 * @param {Record<string, unknown>} [data]
 */
export function logEvent(level, event, data) {
  if (!isFileLoggingEnabled()) return;
  try {
    ensureDir();
    const row = {
      ts: new Date().toISOString(),
      level,
      event,
      ...data,
    };
    fs.appendFile(eventsPath, `${JSON.stringify(row)}\n`, () => {});
  } catch (e) {
    console.error("[fileLog] append failed", e.message);
  }
}
