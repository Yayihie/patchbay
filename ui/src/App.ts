import type { BoardFile } from "./types.js";
import { BoardCanvas } from "./components/BoardCanvas.js";
import { RunView } from "./components/RunView.js";
import { ApprovalRequest } from "./components/ApprovalRequest.js";

export interface AppProps {
  board?: BoardFile;
}

export function App(props: AppProps): { type: string; props: AppProps } {
  return { type: "App", props };
}
