import fs from "fs";
import path from "path";
import { spawn } from "child_process";

// Available models - maps user-friendly names to actual model IDs
// Based on agent CLI available models: auto, composer-1, grok
export const AVAILABLE_MODELS = {
  "auto": "auto",
  "composer-1": "composer-1",
  "grok": "grok",
  // Legacy aliases for backward compatibility
  "gpt-5.2-codex": "composer-1",
  "claude-opus-4.5": "composer-1",
};
export const DEFAULT_MODEL = "composer-1";
export const FIXED_MODEL = DEFAULT_MODEL; // Keep for backward compatibility

export const CORE_PROMPT_NAME = "CORE_PROMPT.md";
export const PROGRESS_NAME = "PROGRESS.json";
export const INDEX_NAME = "INDEX.md";
export const RUN_ONCE_OUTPUT_NAME = "RUN_ONCE_OUTPUT.md";
export const HANDOFF_PROMPT_NAME = "HANDOFF_PROMPT.md"; // 传承 Prompt - 上一轮给下一轮的指导

// Resolve model name to actual model ID
export function resolveModel(modelName) {
  if (!modelName) return DEFAULT_MODEL;
  // Check if it's an alias
  if (AVAILABLE_MODELS[modelName]) {
    return AVAILABLE_MODELS[modelName];
  }
  // Check if it's already a valid model ID
  const validIds = Object.values(AVAILABLE_MODELS);
  if (validIds.includes(modelName)) {
    return modelName;
  }
  // Default fallback
  return DEFAULT_MODEL;
}

// Validate model name
export function isValidModel(modelName) {
  if (!modelName) return true; // Will use default
  const aliases = Object.keys(AVAILABLE_MODELS);
  const validIds = Object.values(AVAILABLE_MODELS);
  return aliases.includes(modelName) || validIds.includes(modelName);
}

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

export async function runAgentPrompt({ agentBin, model, workspaceDir, prompt, enableBrowser = true, enableMcps = true }) {
  const result = await runAgentPromptDetailed({
    agentBin,
    model,
    workspaceDir,
    prompt,
    enableBrowser,
    enableMcps,
  });
  return result.output;
}

export async function runAgentPromptDetailed({
  agentBin,
  model,
  workspaceDir,
  prompt,
  enableBrowser = true,
  enableMcps = true,
}) {
  const chatId = await createChat(agentBin, workspaceDir);
  const args = [
    "-p",
    "-f",  // Force allow all commands
    "--model",
    model,
  ];
  
  // Enable browser automation tools
  if (enableBrowser) {
    args.push("--browser");
  }
  
  // Auto-approve MCP servers
  if (enableMcps) {
    args.push("--approve-mcps");
  }
  
  args.push(
    "--resume",
    chatId,
    "--workspace",
    workspaceDir,
    prompt,
  );
  
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

export function buildRunPrompt(corePrompt, outputDir, previousRunInfo = null) {
  const parts = [corePrompt, ""];
  
  // CRITICAL: Check previous run outputs and handoff prompt
  if (previousRunInfo) {
    parts.push("=== CRITICAL: CHECK PREVIOUS RUN OUTPUTS (MANDATORY) ===");
    parts.push("");
    parts.push("Before starting this run, you MUST thoroughly review the previous run's outputs:");
    parts.push("");
    
    // HANDOFF PROMPT - Most important guidance from previous run
    if (previousRunInfo.handoffPrompt) {
      parts.push(">>> HANDOFF FROM PREVIOUS RUN (READ THIS FIRST!) <<<");
      parts.push("");
      parts.push("The previous run left you this guidance:");
      parts.push("```");
      parts.push(previousRunInfo.handoffPrompt);
      parts.push("```");
      parts.push("");
      parts.push("This is your PRIMARY directive for this run. Follow it closely!");
      parts.push("");
    }
    
    if (previousRunInfo.progress) {
      parts.push(`1. Read ${PROGRESS_NAME} to understand:`);
      parts.push("   - What was accomplished in previous runs");
      parts.push("   - Current run index and what should be done in this run");
      parts.push("   - Any notes or issues from previous runs");
      parts.push(`   - File path: ${path.join(outputDir, PROGRESS_NAME)}`);
      parts.push("");
    }
    
    if (previousRunInfo.index) {
      parts.push(`2. Read ${INDEX_NAME} to see:`);
      parts.push("   - Summary of all previous runs");
      parts.push("   - What outputs were generated");
      parts.push(`   - File path: ${path.join(outputDir, INDEX_NAME)}`);
      parts.push("");
    }
    
    if (previousRunInfo.lastOutput) {
      parts.push(`3. Read ${RUN_ONCE_OUTPUT_NAME} from the LAST run to see:`);
      parts.push("   - What was actually done in the previous run");
      parts.push("   - What files were created/modified");
      parts.push("   - Any errors or issues encountered");
      parts.push(`   - File path: ${path.join(outputDir, RUN_ONCE_OUTPUT_NAME)}`);
      parts.push("");
    }
    
    if (previousRunInfo.runCount > 0) {
      parts.push(`4. Review all files in ${outputDir} and its subdirectories:`);
      parts.push("   - Check what code/files exist from previous runs");
      parts.push("   - Understand the current state of the project");
      parts.push("   - Identify what needs to be improved or extended");
      parts.push("");
    }
    
    parts.push("REQUIREMENTS FOR THIS RUN:");
    parts.push("- You MUST read the above files FIRST before making any changes");
    parts.push("- This run should BUILD UPON and IMPROVE the previous run's work");
    parts.push("- Do NOT start from scratch - continue from where the previous run left off");
    parts.push("- If previous run had issues, address them in this run");
    parts.push("- If previous run was successful, extend or enhance it");
    parts.push("- Make MEASURABLE improvements - each run should show clear progress");
    parts.push("");
    parts.push("=== END OF PREVIOUS RUN CHECK ===");
    parts.push("");
  }
  
  parts.push("Execute one run now.");
  parts.push(`- Ensure ${RUN_ONCE_OUTPUT_NAME} is created in ${outputDir}`);
  parts.push(`- Update ${PROGRESS_NAME} and ${INDEX_NAME}`);
  parts.push("- Only write to the output directory.");
  parts.push("- Do not modify any other file or directory.");
  parts.push("- This restriction is absolute.");
  parts.push("");
  
  // HANDOFF PROMPT requirement
  parts.push("=== HANDOFF PROMPT FOR NEXT RUN (MANDATORY) ===");
  parts.push("");
  parts.push(`At the END of this run, you MUST create/update ${HANDOFF_PROMPT_NAME} in ${outputDir}`);
  parts.push("");
  parts.push("This file should contain a SHORT but ACTIONABLE message for the NEXT run, including:");
  parts.push("1. What you accomplished in this run (1-2 sentences)");
  parts.push("2. What the next run should focus on (specific tasks)");
  parts.push("3. Any issues or blockers the next run needs to address");
  parts.push("4. Key files that were modified and may need further work");
  parts.push("5. Suggested improvements or next steps");
  parts.push("");
  parts.push("Keep it concise (under 500 words) but SPECIFIC and ACTIONABLE.");
  parts.push("Think of it as leaving a note for yourself to continue tomorrow.");
  parts.push("");
  parts.push("Example format:");
  parts.push("```markdown");
  parts.push("# Handoff to Next Run");
  parts.push("");
  parts.push("## What I Did");
  parts.push("- Implemented feature X in file Y");
  parts.push("- Fixed bug Z");
  parts.push("");
  parts.push("## Next Run Should");
  parts.push("1. Add tests for feature X");
  parts.push("2. Optimize performance of function ABC");
  parts.push("3. Fix the edge case in ...");
  parts.push("");
  parts.push("## Watch Out For");
  parts.push("- The API in file.js has a race condition");
  parts.push("- Need to handle error case for ...");
  parts.push("```");
  parts.push("");
  parts.push("=== END OF HANDOFF REQUIREMENT ===");
  
  return parts.join("\n");
}
