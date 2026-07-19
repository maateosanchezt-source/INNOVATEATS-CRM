export const INNOVATEATS_WEBSITE = "https://innovateats.com" as const;
export const INITIAL_AUTHORIZED_EMAIL = "maateosanchezt@gmail.com" as const;
export const MAX_SEQUENCE_TOUCHES = 3 as const;

export const operationModes = [
  "dry_run",
  "draft_only",
  "approved_send",
  "autonomous_send",
  "paused",
  "kill_switch"
] as const;

export type OperationMode = (typeof operationModes)[number];
