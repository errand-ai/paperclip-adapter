export const type = "errand";
export const label = "Errand";

export { agentConfigurationDoc, createServerAdapter } from "./adapter.js";
export { ErrandClient } from "./errand-client.js";
export type { TaskProfile, TaskStatus, ErrandSkill, SkillFile } from "./errand-client.js";
