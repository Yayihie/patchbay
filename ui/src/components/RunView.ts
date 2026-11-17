import type { Run, Step } from "../types.js";

export interface RunViewProps {
  run: Run;
}

export function RunView(props: RunViewProps): { type: string; props: RunViewProps } {
  return { type: "RunView", props };
}

export function riskColor(risk: "read" | "write" | "irreversible"): string {
  return { read: "#22c55e", write: "#f59e0b", irreversible: "#ef4444" }[risk];
}

export function lastStep(run: Run): Step | undefined {
  return run.steps.length ? run.steps[run.steps.length - 1] : undefined;
}
