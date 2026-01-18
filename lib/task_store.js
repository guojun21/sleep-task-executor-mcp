import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "tasks.json");
const DEFAULT_DB = {
  tasks: [],
};

let dbCache = null;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function nowIso() {
  return new Date().toISOString();
}

export function getDbPath() {
  return DB_PATH;
}

export function loadDb() {
  if (dbCache) return dbCache;
  ensureDir(DATA_DIR);
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2), "utf-8");
    dbCache = { tasks: [] };
    return dbCache;
  }
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      dbCache = { tasks: [] };
    } else if (!Array.isArray(parsed.tasks)) {
      dbCache = { ...parsed, tasks: [] };
    } else {
      dbCache = parsed;
    }
  } catch (error) {
    dbCache = { tasks: [] };
  }
  return dbCache;
}

export function saveDb(db) {
  ensureDir(DATA_DIR);
  dbCache = db;
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

export function listTasks() {
  const db = loadDb();
  return db.tasks.slice();
}

export function getTask(taskId) {
  const db = loadDb();
  return db.tasks.find((task) => task.id === taskId) || null;
}

export function addTask(task) {
  const db = loadDb();
  db.tasks.push(task);
  saveDb(db);
  return task;
}

export function updateTask(taskId, patch) {
  const db = loadDb();
  const index = db.tasks.findIndex((task) => task.id === taskId);
  if (index === -1) return null;
  const updated = {
    ...db.tasks[index],
    ...patch,
    updated_at: nowIso(),
  };
  db.tasks[index] = updated;
  saveDb(db);
  return updated;
}
