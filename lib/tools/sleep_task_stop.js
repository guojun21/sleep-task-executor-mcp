import { getTask, updateTask } from "../task_store.js";
import { stopTask, isTaskActive } from "../task_runner.js";
import { logInfo } from "../logger.js";

export const definition = {
  name: "sleep_task_stop",
  description: "Stop a running sleep task",
  inputSchema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "Task id to stop",
      },
    },
    required: ["task_id"],
  },
};

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
  const taskId = typeof args?.task_id === "string" ? args.task_id : "";
  if (!taskId) return errorResult("Missing required parameter: task_id");

  const task = getTask(taskId);
  if (!task) return errorResult(`Task not found: ${taskId}`);

  const wasActive = isTaskActive(taskId);
  const stopped = stopTask(taskId);

  if (wasActive && stopped) {
    logInfo(taskId, "Stop requested by tool", { wasActive: true });
    updateTask(taskId, { status: "stopping" });
    return {
      content: [
        {
          type: "text",
          text: `Stop requested for task: ${taskId}`,
        },
      ],
    };
  }

  if (task.status !== "stopped") {
    logInfo(taskId, "Task marked as stopped by tool", { wasActive: false });
    updateTask(taskId, { status: "stopped" });
  }

  return {
    content: [
      {
        type: "text",
        text: `Task is not active. Marked as stopped: ${taskId}`,
      },
    ],
  };
}
