import { createServerAdapter } from "../adapter.js";

export const errandServerAdapter = createServerAdapter();

export const { execute, testEnvironment, listModels, getConfigSchema } = errandServerAdapter;
