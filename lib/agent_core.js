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

  const progressContent = JSON.stringify({
    goal: goal,
    input_materials: inputMaterials,
    output_dir: outputDir,
    next_run_index: 1,
    runs: [],
    last_run_at: null,
    last_output: null,
    notes: ""
  }, null, 2);

  const indexContent = [
    "# Sleep Task Executor Index",
    "",
    "| Run | Output | Time | Note |",
    "|---:|---|---|---|",
  ].join("\n");

  return [
    "You are running in Cursor Agent mode (non-interactive).",
    "You are initializing a sleep task executor.",
    "",
    "=== PHASE 1: DEEP EXPLORATION (MANDATORY) ===",
    "",
    "Before generating any files, you MUST thoroughly explore and understand the input materials.",
    "This is NOT optional - you cannot generate a good CORE_PROMPT without understanding the context.",
    "",
    "Input materials to explore:",
    inputsList,
    "",
    "Exploration requirements:",
    "1. If an input is a directory, explore its structure (list files, read key files)",
    "2. If an input is a file, read it completely",
    "3. For code repositories: understand the project structure, key modules, existing patterns",
    "4. For documentation: read and understand the requirements, constraints, context",
    "5. Identify: existing code patterns, naming conventions, architecture, dependencies",
    "",
    "User's stated goal:",
    "```",
    goal,
    "```",
    "",
    "After exploration, you should understand:",
    "- What the codebase looks like (if applicable)",
    "- What the user really wants to achieve",
    "- What constraints and context exist",
    "- What specific files/modules are involved",
    "- What the technical approach should be",
    "",
    "=== PHASE 2: GENERATE FILES ===",
    "",
    `Output directory: ${outputDir}`,
    "",
    "Hard rules:",
    "- Only write to the output directory.",
    "- Do not modify any other file or directory.",
    "- This restriction is absolute.",
    "",
    `Generate these 3 files in ${outputDir}:`,
    "",
    "---",
    "",
    `FILE 1: ${CORE_PROMPT_NAME}`,
    "",
    "This is the MOST IMPORTANT file. It will be used as the prompt for all subsequent runs.",
    "It must contain EVERYTHING needed to execute the task, including:",
    "",
    "Required sections:",
    "1. ## Goal - The user's original goal VERBATIM (do not summarize or compress)",
    "2. ## Context Summary - Your understanding after exploring the input materials:",
    "   - Project structure overview",
    "   - Key files and modules identified",
    "   - Existing patterns and conventions discovered",
    "   - Technical constraints found",
    "3. ## Input Materials - List of input paths",
    "4. ## Output Directory - Where to write outputs",
    "5. ## Detailed Execution Plan - Step-by-step plan based on your exploration:",
    "   - Specific files to modify/create",
    "   - Specific functions/modules to work with",
    "   - Technical approach details",
    "   - Testing strategy",
    "6. ## Constraints - Including: only write to output_dir",
    "7. ## Output Artifacts - Files to generate each run",
    "8. ## Verification Criteria - How to verify success",
    "",
    "CRITICAL: The CORE_PROMPT must be DETAILED and ACTIONABLE.",
    "A future AI reading only this file should be able to execute the task without re-exploring.",
    "Include specific file paths, function names, and technical details you discovered.",
    "",
    "---",
    "",
    `FILE 2: ${PROGRESS_NAME}`,
    "Write this JSON content EXACTLY:",
    "",
    "```json",
    progressContent,
    "```",
    "",
    "---",
    "",
    `FILE 3: ${INDEX_NAME}`,
    "Write this content EXACTLY:",
    "",
    "```markdown",
    indexContent,
    "```",
    "",
    "---",
    "",
    "EXECUTION ORDER:",
    "1. First, explore ALL input materials thoroughly (read files, list directories)",
    "2. Then, generate the 3 files based on your understanding",
    "3. Return a brief confirmation of what you explored and generated",
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
