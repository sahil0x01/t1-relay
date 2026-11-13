export const RUN_STATUSES = [
  "queue",
  "provisioning",
  "running",
  "awaiting_input",
  "verifying",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const satisfies readonly RunStatus[];

export function isTerminal(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);
}
