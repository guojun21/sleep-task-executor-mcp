# Sleep Task Executor MCP

This MCP server provides tools to generate core prompt + progress/index,
run a single execution, or start continuous/interval loops via `agent`.

## Tools

- `sleep_task_execute`
  - Inputs:
    - `goal` (string, required)
    - `input_materials` (string[], required)
    - `output_dir` (string, required)
    - `workspace_dir` (string, optional)
    - `agent_bin` (string, optional, default: agent)
    - `run_once` (boolean, optional, default: true)
    - `show_generated` (boolean, optional, default: true)

- `sleep_task_start`
  - Inputs:
    - `goal` (string, required)
    - `input_materials` (string[], required)
    - `output_dir` (string, required)
    - `workspace_dir` (string, optional)
    - `agent_bin` (string, optional, default: agent)
    - `mode` (string, required: continuous | interval)
    - `interval_seconds` (number, optional: continuous default 0, interval default 1800)
    - `max_success_runs` (number, optional: 0 or omitted = unlimited)

- `sleep_task_list`
  - Inputs:
    - `status` (string, optional: running | stopped | stopping | completed | error | stale)

- `sleep_task_stop`
  - Inputs:
    - `task_id` (string, required)

- `sleep_task_log`
  - Inputs:
    - `task_id` (string, required)
    - `tail_lines` (number, optional, default: 200, 0 = all)

## Notes

- Requires `agent` CLI to be installed and logged in.
- Writes only to the specified `output_dir`.
- Uses fixed model: `gpt-5.2-codex-xhigh-fast`.
- Task database: `data/tasks.json`.
- Task logs: `logs/<task_id>.log`.

## Run Semantics

- `continuous`: runs back-to-back; if `interval_seconds > 0`, waits after each run.
- `interval`: waits `interval_seconds` after each run (default 1800 seconds).
- `max_success_runs`: counts only successful runs; stop when reached.

## Logging Details

- Each task logs tool invocation, run start/end, and wait intervals.
- Agent stdout/stderr are captured (truncated) per run.
- Output directory file changes (created/updated/deleted) are logged per run.
