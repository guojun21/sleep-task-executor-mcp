import fs from "fs";
import path from "path";

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    return [];
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    return null;
  }
}

export function snapshotDir(rootDir) {
  const snapshot = new Map();

  const walk = (currentDir) => {
    const entries = safeReadDir(currentDir);
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stat = safeStat(fullPath);
      if (!stat) continue;
      const relPath = path.relative(rootDir, fullPath);
      snapshot.set(relPath, {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  };

  walk(rootDir);
  return snapshot;
}

export function diffSnapshots(beforeSnapshot, afterSnapshot) {
  const created = [];
  const updated = [];
  const deleted = [];

  for (const [relPath, afterMeta] of afterSnapshot.entries()) {
    const beforeMeta = beforeSnapshot.get(relPath);
    if (!beforeMeta) {
      created.push({ path: relPath, ...afterMeta });
      continue;
    }
    if (
      beforeMeta.size !== afterMeta.size ||
      Math.abs(beforeMeta.mtimeMs - afterMeta.mtimeMs) > 1
    ) {
      updated.push({
        path: relPath,
        before: beforeMeta,
        after: afterMeta,
      });
    }
  }

  for (const [relPath, beforeMeta] of beforeSnapshot.entries()) {
    if (!afterSnapshot.has(relPath)) {
      deleted.push({ path: relPath, ...beforeMeta });
    }
  }

  return { created, updated, deleted };
}

function trimList(items, limit) {
  if (items.length <= limit) {
    return { items, total: items.length, truncated: false };
  }
  return { items: items.slice(0, limit), total: items.length, truncated: true };
}

export function summarizeChanges(diff, limit = 50) {
  return {
    created: trimList(diff.created, limit),
    updated: trimList(diff.updated, limit),
    deleted: trimList(diff.deleted, limit),
  };
}
