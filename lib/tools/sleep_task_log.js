import { readTaskLog, getLogFilePath } from "../logger.js";
import { getTask } from "../task_store.js";

export const definition = {
  name: "sleep_task_log",
  description: "Read the log file of a sleep task (last N lines)",
  inputSchema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "The task id to read log for",
      },
      tail_lines: {
        type: "number",
        description: "Number of lines from the end to return (default: 200, 0 = all)",
      },
    },
    required: ["task_id"],
  },
};

export async function handler(args) {
  const taskId = typeof args.task_id === "string" ? args.task_id.trim() : "";
  const tailLines =
    typeof args.tail_lines === "number" ? args.tail_lines : 200;

  if (!taskId) {
    return {
      content: [{ type: "text", text: "Error: Missing required parameter: task_id" }],
      isError: true,
    };
  }

  const task = getTask(taskId);
  const logPath = getLogFilePath(taskId);
  const logContent = readTaskLog(taskId, tailLines);

  if (logContent === null) {
    return {
      content: [
        {
          type: "text",
          text: `No log file found for task: ${taskId}\nExpected path: ${logPath}`,
        },
      ],
      isError: true,
    };
  }

  const header = [
    `Task ID: ${taskId}`,
    task ? `Goal: ${task.goal}` : "(task not in DB)",
    task ? `Status: ${task.status}` : "",
    task ? `Run count: ${task.run_count}` : "",
    `Log file: ${logPath}`,
    `Showing last ${tailLines > 0 ? tailLines : "all"} lines`,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    content: [
      {
        type: "text",
        text: `${header}\n${logContent}`,
      },
    ],
  };
}
