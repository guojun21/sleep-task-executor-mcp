import fs from "fs";
import path from "path";
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  resolveModel,
  isValidModel,
  CORE_PROMPT_NAME,
  PROGRESS_NAME,
  INDEX_NAME,
  RUN_ONCE_OUTPUT_NAME,
  HANDOFF_PROMPT_NAME,
  toStringArray,
  ensureDir,
  commonAncestor,
  checkAgentLogin,
  runAgentPrompt,
  buildGenerationPrompt,
  buildRunPrompt,
  truncate,
} from "../agent_core.js";

export const definition = {
  name: "sleep_task_execute",
  description:
    "Generate core prompt + progress/index from goal/materials/output, then run once via agent with model selection and full tool access",
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
      model: {
        type: "string",
        enum: ["gpt-5.2-codex", "claude-opus-4.5"],
        description: "Model to use: 'gpt-5.2-codex' (default) or 'claude-opus-4.5'",
      },
      run_once: {
        type: "boolean",
        description: "Whether to execute one run after generation",
        default: true,
      },
      show_generated: {
        type: "boolean",
        description: "Whether to include generated file contents in output",
        default: true,
      },
      enable_browser: {
        type: "boolean",
        description: "Enable browser automation tools (default: true)",
      },
      enable_mcps: {
        type: "boolean",
        description: "Enable MCP servers and auto-approve them (default: true)",
      },
    },
    required: ["goal", "input_materials", "output_dir"],
  },
};

export async function handler(args) {
  try {
    const goal = typeof args.goal === "string" ? args.goal.trim() : "";
    const inputMaterials = toStringArray(args.input_materials);
    const outputDir = typeof args.output_dir === "string" ? args.output_dir : "";
    const workspaceOverride =
      typeof args.workspace_dir === "string" ? args.workspace_dir : "";
    const modelInput = typeof args.model === "string" ? args.model.trim() : "";
    const agentBin = typeof args.agent_bin === "string" ? args.agent_bin : "agent";
    const runOnce = args.run_once !== false;
    const showGenerated = args.show_generated !== false;
    const enableBrowser = args.enable_browser !== false;
    const enableMcps = args.enable_mcps !== false;

    if (!goal) {
      return errorResult("Missing required parameter: goal");
    }
    if (!outputDir) {
      return errorResult("Missing required parameter: output_dir");
    }
    
    // Validate and resolve model
    if (modelInput && !isValidModel(modelInput)) {
      const availableModels = Object.keys(AVAILABLE_MODELS).join(", ");
      return errorResult(`Invalid model '${modelInput}'. Available models: ${availableModels}`);
    }
    const model = resolveModel(modelInput);

    const resolvedOutputDir = path.resolve(outputDir);
    ensureDir(resolvedOutputDir);

    const resolvedInputs = inputMaterials.map((item) => path.resolve(item));
    const workspaceDir = workspaceOverride
      ? path.resolve(workspaceOverride)
      : commonAncestor([...resolvedInputs, resolvedOutputDir]);

    const warnings = [];
    for (const inputPath of resolvedInputs) {
      if (!fs.existsSync(inputPath)) {
        warnings.push(`Input material does not exist: ${inputPath}`);
      }
    }

    await checkAgentLogin(agentBin, workspaceDir);

    const generationPrompt = buildGenerationPrompt({
      goal,
      inputMaterials: resolvedInputs,
      outputDir: resolvedOutputDir,
    });
    const generationLog = await runAgentPrompt({
      agentBin,
      model,
      workspaceDir,
      prompt: generationPrompt,
      enableBrowser,
      enableMcps,
    });

    const corePromptPath = path.join(resolvedOutputDir, CORE_PROMPT_NAME);
    const progressPath = path.join(resolvedOutputDir, PROGRESS_NAME);
    const indexPath = path.join(resolvedOutputDir, INDEX_NAME);

    const corePrompt = fs.existsSync(corePromptPath)
      ? fs.readFileSync(corePromptPath, "utf-8")
      : "";
    const progressContent = fs.existsSync(progressPath)
      ? fs.readFileSync(progressPath, "utf-8")
      : "";
    const indexContent = fs.existsSync(indexPath)
      ? fs.readFileSync(indexPath, "utf-8")
      : "";

    let runLog = "";
    let runOutputContent = "";
    if (runOnce) {
      const runPrompt = buildRunPrompt(corePrompt || generationPrompt, resolvedOutputDir);
      runLog = await runAgentPrompt({
        agentBin,
        model,
        workspaceDir,
        prompt: runPrompt,
        enableBrowser,
        enableMcps,
      });
      const runOutputPath = path.join(resolvedOutputDir, RUN_ONCE_OUTPUT_NAME);
      if (fs.existsSync(runOutputPath)) {
        runOutputContent = fs.readFileSync(runOutputPath, "utf-8");
      } else {
        warnings.push(`Run output not found: ${runOutputPath}`);
      }
    }

    const sections = [];
    sections.push("Sleep task executor generation completed.");
    sections.push(`Model: ${model}`);
    sections.push(`Workspace: ${workspaceDir}`);
    sections.push(`Output directory: ${resolvedOutputDir}`);
    sections.push(`Browser tools: ${enableBrowser ? "enabled" : "disabled"}`);
    sections.push(`MCP tools: ${enableMcps ? "enabled" : "disabled"}`);
    if (warnings.length) {
      sections.push("");
      sections.push("Warnings:");
      sections.push(warnings.map((w) => `- ${w}`).join("\n"));
    }

    sections.push("");
    sections.push("Generated files:");
    sections.push(`- ${corePromptPath}`);
    sections.push(`- ${progressPath}`);
    sections.push(`- ${indexPath}`);

    if (showGenerated) {
      sections.push("");
      sections.push(`${CORE_PROMPT_NAME}:\n${truncate(corePrompt)}`);
      sections.push("");
      sections.push(`${PROGRESS_NAME}:\n${truncate(progressContent)}`);
      sections.push("");
      sections.push(`${INDEX_NAME}:\n${truncate(indexContent)}`);
    }

    sections.push("");
    sections.push("Generation agent output (truncated):");
    sections.push(truncate(generationLog));

    if (runOnce) {
      sections.push("");
      sections.push("Run-once agent output (truncated):");
      sections.push(truncate(runLog));
      if (showGenerated && runOutputContent) {
        sections.push("");
        sections.push(`${RUN_ONCE_OUTPUT_NAME}:\n${truncate(runOutputContent)}`);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: sections.join("\n"),
        },
      ],
    };
  } catch (error) {
    return errorResult(error.message);
  }
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
