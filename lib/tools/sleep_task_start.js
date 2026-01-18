import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  FIXED_MODEL,
  CORE_PROMPT_NAME,
  PROGRESS_NAME,
  INDEX_NAME,
  RUN_ONCE_OUTPUT_NAME,
  toStringArray,
  ensureDir,
  commonAncestor,
  checkAgentLogin,
  runAgentPromptDetailed,
  buildGenerationPrompt,
  truncate,
  nowIso,
} from "../agent_core.js";
import { addTask, getDbPath } from "../task_store.js";
import { startTaskLoop } from "../task_runner.js";
import { logInfo, logError, logDebug } from "../logger.js";
import { snapshotDir, diffSnapshots, summarizeChanges } from "../fs_snapshot.js";

export const definition = {
  name: "sleep_task_start",
  description:
    "Start a continuous or interval sleep task loop (fixed model, agent mode)",
  inputSchema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "Goal or objective for the sleep task executor",
      },
      input_materials: {
        type: "array",
        items: { type: "string" },
        description: "Absolute or relative paths to input materials",
      },
      output_dir: {
        type: "string",
        description: "Output directory for generated artifacts",
      },
      workspace_dir: {
        type: "string",
        description:
          "Workspace directory for agent (default: common ancestor of inputs + output)",
      },
      agent_bin: {
        type: "string",
        description: "Path to agent binary (default: agent in PATH)",
      },
      mode: {
        type: "string",
        description: "Run mode: continuous or interval",
      },
      interval_seconds: {
        type: "number",
        description: "Interval seconds between runs (continuous default: 0, interval default: 1800)",
      },
      max_success_runs: {
        type: "number",
        description: "Stop after N successful runs (0 or omitted = unlimited)",
      },
    },
    required: ["goal", "input_materials", "output_dir", "mode"],
  },
};

function createTaskId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `task_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function errorResult(message) {
  return {
    content: [
      {
        type: "text",
        text: `Error: ${message}`,
      },
    ],
    isError: true,
  };
}

export async function handler(args) {
  let taskId = null;
  try {
    const goal = typeof args.goal === "string" ? args.goal.trim() : "";
    const inputMaterials = toStringArray(args.input_materials);
    const outputDir = typeof args.output_dir === "string" ? args.output_dir : "";
    const workspaceOverride =
      typeof args.workspace_dir === "string" ? args.workspace_dir : "";
    const agentBin = typeof args.agent_bin === "string" ? args.agent_bin : "agent";
    const mode = typeof args.mode === "string" ? args.mode.trim() : "";
    const intervalRaw =
      typeof args.interval_seconds === "number" ? args.interval_seconds : null;
    const maxSuccessRaw =
      typeof args.max_success_runs === "number" ? args.max_success_runs : null;

    if (!goal) return errorResult("Missing required parameter: goal");
    if (!outputDir) return errorResult("Missing required parameter: output_dir");
    if (!mode) return errorResult("Missing required parameter: mode");
    if (!["continuous", "interval"].includes(mode)) {
      return errorResult("Invalid mode. Use 'continuous' or 'interval'.");
    }
    const intervalSeconds = mode === "interval" ? intervalRaw ?? 1800 : intervalRaw ?? 0;
    if (intervalSeconds < 0) {
      return errorResult("interval_seconds must be >= 0.");
    }
    if (mode === "interval" && intervalSeconds <= 0) {
      return errorResult("interval_seconds must be greater than 0 for interval mode.");
    }
    const maxSuccessRuns = maxSuccessRaw ?? 0;
    if (!Number.isFinite(maxSuccessRuns) || maxSuccessRuns < 0) {
      return errorResult("max_success_runs must be >= 0.");
    }
    if (maxSuccessRuns > 0 && Math.floor(maxSuccessRuns) !== maxSuccessRuns) {
      return errorResult("max_success_runs must be an integer.");
    }

    const resolvedOutputDir = path.resolve(outputDir);
    ensureDir(resolvedOutputDir);

    const resolvedInputs = inputMaterials.map((item) => path.resolve(item));
    const workspaceDir = workspaceOverride
      ? path.resolve(workspaceOverride)
      : commonAncestor([...resolvedInputs, resolvedOutputDir]);

    await checkAgentLogin(agentBin, workspaceDir);

    taskId = createTaskId();
    const createdAt = nowIso();
    logInfo(taskId, "sleep_task_start invoked", {
      goal,
      mode,
      intervalSeconds,
      maxSuccessRuns,
      outputDir: resolvedOutputDir,
      workspaceDir,
      inputMaterials: resolvedInputs,
    });

    const generationPrompt = buildGenerationPrompt({
      goal,
      inputMaterials: resolvedInputs,
      outputDir: resolvedOutputDir,
    });
    logInfo(taskId, "Generation started");
    const beforeGen = snapshotDir(resolvedOutputDir);
    const genResult = await runAgentPromptDetailed({
      agentBin,
      model: FIXED_MODEL,
      workspaceDir,
      prompt: generationPrompt,
    });
    logDebug(taskId, "Generation agent output (truncated)", {
      output: truncate(genResult.output, 4000),
      chatId: genResult.chatId,
    });
    const afterGen = snapshotDir(resolvedOutputDir);
    const genChanges = summarizeChanges(
      diffSnapshots(beforeGen, afterGen),
      50
    );
    logInfo(taskId, "Generation output dir changes", genChanges);

    const corePromptPath = path.join(resolvedOutputDir, CORE_PROMPT_NAME);
    const corePrompt = fs.existsSync(corePromptPath)
      ? fs.readFileSync(corePromptPath, "utf-8")
      : generationPrompt;

    const taskRecord = {
      id: taskId,
      goal,
      input_materials: resolvedInputs,
      output_dir: resolvedOutputDir,
      workspace_dir: workspaceDir,
      mode,
      interval_seconds: intervalSeconds,
      max_success_runs: maxSuccessRuns,
      status: "running",
      run_count: 0,
      created_at: createdAt,
      updated_at: createdAt,
      last_run_at: null,
      last_output_path: path.join(resolvedOutputDir, RUN_ONCE_OUTPUT_NAME),
      last_error: null,
      agent_model: FIXED_MODEL,
      artifacts: {
        core_prompt: corePromptPath,
        progress: path.join(resolvedOutputDir, PROGRESS_NAME),
        index: path.join(resolvedOutputDir, INDEX_NAME),
      },
    };

    addTask(taskRecord);
    logInfo(taskId, "Task record created", {
      dbPath: getDbPath(),
      outputDir: resolvedOutputDir,
    });

    startTaskLoop({
      taskId,
      agentBin,
      workspaceDir,
      outputDir: resolvedOutputDir,
      corePrompt,
      mode,
      intervalSeconds,
      maxSuccessRuns,
    });

    const progressPath = path.join(resolvedOutputDir, PROGRESS_NAME);
    const indexPath = path.join(resolvedOutputDir, INDEX_NAME);
    const summary = [
      "Sleep task started.",
      `Task id: ${taskId}`,
      `Mode: ${mode}`,
      `Interval seconds: ${intervalSeconds}`,
      `Max success runs: ${maxSuccessRuns}`,
      `Goal: ${goal}`,
      `Output dir: ${resolvedOutputDir}`,
      `Workspace: ${workspaceDir}`,
      `DB path: ${getDbPath()}`,
      `Artifacts: ${corePromptPath}, ${progressPath}, ${indexPath}`,
    ];

    return {
      content: [
        {
          type: "text",
          text: summary.join("\n"),
        },
      ],
    };
  } catch (error) {
    if (taskId && error?.message) {
      const extra = { stack: error.stack };
      if (error.output) {
        extra.output = truncate(error.output, 4000);
      }
      if (error.chatId) {
        extra.chatId = error.chatId;
      }
      logError(taskId, `sleep_task_start failed: ${error.message}`, extra);
    }
    return errorResult(error.message);
  }
}
