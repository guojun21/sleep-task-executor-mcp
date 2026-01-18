import { listTasks, getDbPath } from "../task_store.js";
import { listActiveTaskIds } from "../task_runner.js";

export const definition = {
  name: "sleep_task_list",
  description: "List sleep tasks and their status/run counts",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description:
          "Optional status filter (running, stopped, stopping, completed, error, stale)",
      },
    },
  },
};

function normalizeStatus(task, activeIds) {
  if (activeIds.has(task.id)) return "running";
  if (task.status === "running") return "stale";
  return task.status || "unknown";
}

export async function handler(args) {
  const statusFilter = typeof args?.status === "string" ? args.status : "";
  const tasks = listTasks();
  const activeIds = new Set(listActiveTaskIds());
  const rows = tasks
    .map((task) => ({
      ...task,
      runtime_status: normalizeStatus(task, activeIds),
    }))
    .filter((task) => (statusFilter ? task.runtime_status === statusFilter : true));

  const lines = [];
  lines.push(`DB: ${getDbPath()}`);
  lines.push(`Total tasks: ${rows.length}`);

  if (rows.length === 0) {
    lines.push("No tasks found.");
    return {
      content: [
        {
          type: "text",
          text: lines.join("\n"),
        },
      ],
    };
  }

  rows.forEach((task, index) => {
    lines.push("");
    lines.push(`Task ${index + 1}:`);
    lines.push(`- id: ${task.id}`);
    lines.push(`- status: ${task.runtime_status}`);
    lines.push(`- mode: ${task.mode}`);
    lines.push(`- interval_seconds: ${task.interval_seconds || 0}`);
    lines.push(`- max_success_runs: ${task.max_success_runs || 0}`);
    lines.push(`- run_count: ${task.run_count || 0}`);
    lines.push(`- last_run_at: ${task.last_run_at || "null"}`);
    lines.push(`- goal: ${task.goal || ""}`);
    lines.push(`- output_dir: ${task.output_dir || ""}`);
    lines.push(`- workspace_dir: ${task.workspace_dir || ""}`);
    lines.push(`- input_materials: ${(task.input_materials || []).join(", ")}`);
  });

  return {
    content: [
      {
        type: "text",
        text: lines.join("\n"),
      },
    ],
  };
}
