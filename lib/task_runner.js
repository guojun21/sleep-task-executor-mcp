import path from "path";
import {
  FIXED_MODEL,
  RUN_ONCE_OUTPUT_NAME,
  buildRunPrompt,
  runAgentPromptDetailed,
  nowIso,
  truncate,
} from "./agent_core.js";
import { getTask, updateTask } from "./task_store.js";
import { logInfo, logError, logWarn, logDebug } from "./logger.js";
import { snapshotDir, diffSnapshots, summarizeChanges } from "./fs_snapshot.js";

const activeTasks = new Map();

function delay(ms, controller) {
  return new Promise((resolve) => {
    if (controller.stopRequested) {
      resolve();
      return;
    }
    controller.timer = setTimeout(() => {
      controller.timer = null;
      resolve();
    }, ms);
  });
}

export function listActiveTaskIds() {
  return Array.from(activeTasks.keys());
}

export function isTaskActive(taskId) {
  return activeTasks.has(taskId);
}

export function stopTask(taskId) {
  const controller = activeTasks.get(taskId);
  if (!controller) return false;
  controller.stopRequested = true;
  if (controller.timer) {
    clearTimeout(controller.timer);
    controller.timer = null;
  }
  return true;
}

export function startTaskLoop({
  taskId,
  agentBin,
  workspaceDir,
  outputDir,
  corePrompt,
  mode,
  intervalSeconds,
  maxSuccessRuns,
}) {
  if (activeTasks.has(taskId)) {
    throw new Error(`Task already running: ${taskId}`);
  }

  const controller = {
    stopRequested: false,
    timer: null,
  };
  activeTasks.set(taskId, controller);

  const runOutputPath = path.join(outputDir, RUN_ONCE_OUTPUT_NAME);

  logInfo(taskId, "Task loop started", {
    mode,
    intervalSeconds,
    maxSuccessRuns,
    outputDir,
    workspaceDir,
  });

  const loop = async () => {
    while (!controller.stopRequested) {
      const runAt = nowIso();
      const currentTask = getTask(taskId);
      const runCount = currentTask ? currentTask.run_count || 0 : 0;
      logInfo(taskId, `Starting run #${runCount + 1}`, { runAt });
      try {
        const beforeSnapshot = snapshotDir(outputDir);
        logDebug(taskId, "Snapshot before run captured", {
          fileCount: beforeSnapshot.size,
        });
        const runPrompt = buildRunPrompt(corePrompt, outputDir);
        logDebug(taskId, "Calling agent", { model: FIXED_MODEL });
        const agentResult = await runAgentPromptDetailed({
          agentBin,
          model: FIXED_MODEL,
          workspaceDir,
          prompt: runPrompt,
        });
        if (agentResult.output) {
          logDebug(taskId, "Agent output (truncated)", {
            output: truncate(agentResult.output, 4000),
            chatId: agentResult.chatId,
          });
        }
        const nextRunCount = runCount + 1;
        logInfo(taskId, `Run #${nextRunCount} succeeded`);
        const afterSnapshot = snapshotDir(outputDir);
        const changes = summarizeChanges(
          diffSnapshots(beforeSnapshot, afterSnapshot),
          50
        );
        logInfo(taskId, "Output dir changes", changes);
        const current = updateTask(taskId, {
          status: "running",
          last_run_at: runAt,
          last_output_path: runOutputPath,
          last_error: null,
          run_count: nextRunCount,
        });
        if (!current) {
          logWarn(taskId, "Task deleted during run, stopping");
          controller.stopRequested = true;
          break;
        }
        if (maxSuccessRuns > 0 && nextRunCount >= maxSuccessRuns) {
          logInfo(taskId, `Reached max success runs (${maxSuccessRuns}), completing`);
          updateTask(taskId, { status: "completed" });
          controller.stopRequested = true;
          break;
        }
      } catch (error) {
        const extra = { stack: error.stack };
        if (error.output) {
          extra.output = truncate(error.output, 4000);
        }
        if (error.chatId) {
          extra.chatId = error.chatId;
        }
        logError(taskId, `Run failed: ${error.message}`, extra);
        updateTask(taskId, {
          status: "error",
          last_run_at: runAt,
          last_output_path: runOutputPath,
          last_error: error.message,
        });
        controller.stopRequested = true;
        break;
      }

      if (controller.stopRequested) {
        break;
      }

      if (intervalSeconds > 0) {
        logInfo(taskId, `Waiting ${intervalSeconds}s before next run`);
        await delay(intervalSeconds * 1000, controller);
      } else {
        await delay(0, controller);
      }
    }

    if (controller.stopRequested) {
      const updated = getTask(taskId);
      if (updated && (updated.status === "running" || updated.status === "stopping")) {
        logInfo(taskId, "Task stopped");
        updateTask(taskId, { status: "stopped" });
      }
    }
    activeTasks.delete(taskId);
    logInfo(taskId, "Task loop ended");
  };

  loop().catch((error) => {
    logError(taskId, `Loop crashed: ${error.message}`, { stack: error.stack });
    updateTask(taskId, {
      status: "error",
      last_error: error.message,
    });
    activeTasks.delete(taskId);
  });
}
