import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.resolve(__dirname, "..", "logs");

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function nowTs() {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

function getLogPath(taskId) {
  ensureLogDir();
  return path.join(LOG_DIR, `${taskId}.log`);
}

function formatMessage(level, taskId, message, extra) {
  const ts = nowTs();
  let line = `[${ts}] [${level}] [${taskId}] ${message}`;
  if (extra !== undefined) {
    if (typeof extra === "object") {
      line += ` | ${JSON.stringify(extra)}`;
    } else {
      line += ` | ${String(extra)}`;
    }
  }
  return line;
}

function appendLog(taskId, level, message, extra) {
  const logPath = getLogPath(taskId);
  const line = formatMessage(level, taskId, message, extra) + "\n";
  fs.appendFileSync(logPath, line, "utf-8");
}

export function logInfo(taskId, message, extra) {
  appendLog(taskId, "INFO", message, extra);
}

export function logWarn(taskId, message, extra) {
  appendLog(taskId, "WARN", message, extra);
}

export function logError(taskId, message, extra) {
  appendLog(taskId, "ERROR", message, extra);
}

export function logDebug(taskId, message, extra) {
  appendLog(taskId, "DEBUG", message, extra);
}

export function readTaskLog(taskId, tailLines = 200) {
  const logPath = getLogPath(taskId);
  if (!fs.existsSync(logPath)) {
    return null;
  }
  const content = fs.readFileSync(logPath, "utf-8");
  if (tailLines <= 0) {
    return content;
  }
  const lines = content.split("\n");
  const startIdx = Math.max(0, lines.length - tailLines);
  return lines.slice(startIdx).join("\n");
}

export function getLogFilePath(taskId) {
  return getLogPath(taskId);
}

export { LOG_DIR };
