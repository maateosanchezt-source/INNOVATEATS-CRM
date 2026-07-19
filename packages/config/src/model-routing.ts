import type { ServerEnvironment } from "./env.js";

export const modelTaskNames = ["research", "strategy", "copy", "qa", "classifier"] as const;
export type ModelTaskName = (typeof modelTaskNames)[number];

export interface ModelRoute {
  readonly task: ModelTaskName;
  readonly environmentKey:
    | "OPENAI_RESEARCH_MODEL"
    | "OPENAI_STRATEGY_MODEL"
    | "OPENAI_COPY_MODEL"
    | "OPENAI_QA_MODEL"
    | "OPENAI_CLASSIFIER_MODEL";
  readonly model: string | null;
  readonly configured: boolean;
  readonly qualityTier: "strong_baseline";
  readonly downgradeAllowed: false;
}

export function modelRoutingPlan(environment: ServerEnvironment): readonly ModelRoute[] {
  const routes = [
    ["research", "OPENAI_RESEARCH_MODEL"],
    ["strategy", "OPENAI_STRATEGY_MODEL"],
    ["copy", "OPENAI_COPY_MODEL"],
    ["qa", "OPENAI_QA_MODEL"],
    ["classifier", "OPENAI_CLASSIFIER_MODEL"]
  ] as const;

  return routes.map(([task, environmentKey]) => {
    const model = environment[environmentKey] ?? null;
    return {
      task,
      environmentKey,
      model,
      configured: model !== null,
      qualityTier: "strong_baseline",
      downgradeAllowed: false
    };
  });
}

export function modelForTask(environment: ServerEnvironment, task: ModelTaskName): string {
  const route = modelRoutingPlan(environment).find((item) => item.task === task);
  if (route?.model === null || route?.model === undefined) {
    throw new Error(`No model is configured for task "${task}".`);
  }
  return route.model;
}
