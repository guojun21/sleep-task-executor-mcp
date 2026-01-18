import fs from "fs";
import path from "path";
import { spawn } from "child_process";

export const FIXED_MODEL = "gpt-5.2-codex-xhigh-fast";
export const CORE_PROMPT_NAME = "CORE_PROMPT.md";
export const PROGRESS_NAME = "PROGRESS.json";
export const INDEX_NAME = "INDEX.md";
export const RUN_ONCE_OUTPUT_NAME = "RUN_ONCE_OUTPUT.md";

export function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function commonAncestor(paths) {
  if (!paths.length) return process.cwd();
  const splitPaths = paths.map((p) =>
    path.resolve(p).split(path.sep).filter((part) => part.length > 0)
  );
  let common = splitPaths[0];
  for (const parts of splitPaths.slice(1)) {
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) {
      i += 1;
    }
    common = common.slice(0, i);
  }
  return path.sep + common.join(path.sep);
}

export function truncate(text, limit = 4000) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n... (truncated, total ${text.length} chars)`;
}

export function nowIso() {
  return new Date().toISOString();
}

export async function runCommand(bin, args, options = {}) {
  return await new Promise((resolve) => {
    const proc = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (proc.stdout) {
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (proc.stderr) {
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    proc.on("error", (error) => {
      stderr += `\n${error.message}`;
    });

    proc.on("close", (code) => {
      resolve({
        status: typeof code === "number" ? code : -1,
        stdout,
        stderr,
      });
    });
  });
}

export async function checkAgentLogin(agentBin, workspaceDir) {
  const status = await runCommand(agentBin, ["status"], { cwd: workspaceDir });
  const output = `${status.stdout}${status.stderr}`;
  if (output.includes("Not logged in") || output.includes("Run 'agent login'")) {
    throw new Error(
      "Agent is not logged in. Run `agent login` in a terminal first."
    );
  }
  if (status.status !== 0) {
    throw new Error(`agent status failed: ${output.trim()}`);
  }
}

export async function createChat(agentBin, workspaceDir) {
  const res = await runCommand(agentBin, ["create-chat"], { cwd: workspaceDir });
  if (res.status !== 0) {
    throw new Error(`agent create-chat failed: ${res.stdout}${res.stderr}`);
  }
  const lines = res.stdout.trim().split(/\r?\n/).filter(Boolean);
  const chatId = lines[lines.length - 1];
  if (!chatId) {
    throw new Error("agent create-chat did not return a chat id");
  }
  return chatId;
}

export async function runAgentPrompt({ agentBin, model, workspaceDir, prompt }) {
  const result = await runAgentPromptDetailed({
    agentBin,
    model,
    workspaceDir,
    prompt,
  });
  return result.output;
}

export async function runAgentPromptDetailed({
  agentBin,
  model,
  workspaceDir,
  prompt,
}) {
  const chatId = await createChat(agentBin, workspaceDir);
  const args = [
    "-p",
    "--model",
    model,
    "--resume",
    chatId,
    "--workspace",
    workspaceDir,
    prompt,
  ];
  const res = await runCommand(agentBin, args, { cwd: workspaceDir });
  const output = `${res.stdout}${res.stderr}`;
  if (res.status !== 0) {
    const err = new Error(`agent run failed: ${output}`);
    err.stdout = res.stdout;
    err.stderr = res.stderr;
    err.output = output;
    err.chatId = chatId;
    throw err;
  }
  return {
    output,
    stdout: res.stdout,
    stderr: res.stderr,
    chatId,
  };
}

export function buildGenerationPrompt({ goal, inputMaterials, outputDir }) {
  const inputsList = inputMaterials.length
    ? inputMaterials.map((item) => `- ${item}`).join("\n")
    : "- (none)";
  return [
    "You are running in Cursor Agent mode (non-interactive).",
    "You are initializing a sleep task executor.",
    "Generate the following files in the specified output directory.",
    "",
    `Goal: ${goal}`,
    "Input materials:",
    inputsList,
    `Output directory: ${outputDir}`,
    "",
    "Write these files (overwrite if already exists):",
    `1) ${CORE_PROMPT_NAME}`,
    `2) ${PROGRESS_NAME}`,
    `3) ${INDEX_NAME}`,
    "",
    "Hard rules:",
    "- Only write to the output directory.",
    "- Do not modify any other file or directory.",
    "- This restriction is absolute.",
    "- Use ASCII characters only (no non-ASCII).",
    "- Keep the content concise but complete.",
    "",
    `${CORE_PROMPT_NAME} requirements:`,
    "- Title: Sleep Task Executor Core Prompt",
    "- Sections: Goal, Input Materials, Output Directory, Constraints,",
    "  Execution Steps, Output Artifacts, Verification",
    "- Execution Steps must include generating:",
    `  - ${RUN_ONCE_OUTPUT_NAME} (single-run output file)`,
    `  - updating ${PROGRESS_NAME}`,
    `  - updating ${INDEX_NAME}`,
    "- Constraints must include: only write to output_dir, no other edits",
    "",
    `${PROGRESS_NAME} schema (JSON):`,
    "{",
    '  "goal": "<goal>",',
    '  "input_materials": ["<path1>", "<path2>"],',
    '  "output_dir": "<output_dir>",',
    '  "next_run_index": 1,',
    '  "runs": [],',
    '  "last_run_at": null,',
    '  "last_output": null,',
    '  "notes": ""',
    "}",
    "",
    `${INDEX_NAME} template:`,
    "# Sleep Task Executor Index",
    "",
    "| Run | Output | Time | Note |",
    "|---:|---|---|---|",
    "",
    "After writing files, return a brief confirmation.",
  ].join("\n");
}

export function buildRunPrompt(corePrompt, outputDir) {
  return [
    corePrompt,
    "",
    "Execute one run now.",
    `- Ensure ${RUN_ONCE_OUTPUT_NAME} is created in ${outputDir}`,
    `- Update ${PROGRESS_NAME} and ${INDEX_NAME}`,
    "- Only write to the output directory.",
    "- Do not modify any other file or directory.",
    "- This restriction is absolute.",
  ].join("\n");
}
