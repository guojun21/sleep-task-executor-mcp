import * as sleepTaskExecute from "./sleep_task_execute.js";
import * as sleepTaskStart from "./sleep_task_start.js";
import * as sleepTaskList from "./sleep_task_list.js";
import * as sleepTaskStop from "./sleep_task_stop.js";
import * as sleepTaskLog from "./sleep_task_log.js";

export const toolModules = [
  sleepTaskExecute,
  sleepTaskStart,
  sleepTaskList,
  sleepTaskStop,
  sleepTaskLog,
];

export function getAllToolDefinitions() {
  return toolModules.map((module) => module.definition);
}

export async function handleToolCall(name, args) {
  for (const module of toolModules) {
    if (module.definition.name === name) {
      return await module.handler(args);
    }
  }
  return null;
}
