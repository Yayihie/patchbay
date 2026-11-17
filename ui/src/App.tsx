import React, { useState, useEffect, useCallback } from "react";
import {
  getBoards,
  postRun,
  getRun,
  postApprove,
  type BoardFile,
  type Run,
} from "./api.js";
import { BoardList } from "./components/BoardList.js";
import { BoardCanvas } from "./components/BoardCanvas.js";
import { RunView } from "./components/RunView.js";
import { ApprovalRequest } from "./components/ApprovalRequest.js";

type View = "boards" | "board" | "run" | "approval";

export interface AppProps {
  board?: BoardFile;
}

interface AppState {
  view: View;
  boards: BoardFile[];
  selectedBoard: BoardFile | null;
  selectedRun: Run | null;
  loading: boolean;
  error: string | null;
}

export function App(props: AppProps) {
  const [state, setState] = useState<AppState>({
    view: "boards",
    boards: [],
    selectedBoard: null,
    selectedRun: null,
    loading: false,
    error: null,
  });

  const loadBoards = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const boards = await getBoards();
      setState((s) => ({ ...s, boards, loading: false }));
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, []);

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  const selectBoard = useCallback((board: BoardFile) => {
    setState((s) => ({ ...s, selectedBoard: board, view: "board", error: null }));
  }, []);

  const runBoard = useCallback(async (boardId: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { runId } = await postRun(boardId);
      const run = await getRun(runId);
      setState((s) => ({ ...s, selectedRun: run, view: "run", loading: false }));
      pollRun(runId);
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, []);

  const pollRun = useCallback(
    (runId: string) => {
      const interval = setInterval(async () => {
        try {
          const run = await getRun(runId);
          setState((s) => ({ ...s, selectedRun: run }));
          if (run.status !== "running" && run.status !== "paused") {
            clearInterval(interval);
          }
        } catch {
          clearInterval(interval);
        }
      }, 2000);
      return () => clearInterval(interval);
    },
    []
  );

  const approve = useCallback(
    async (runId: string, decision: "approve" | "deny") => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        await postApprove(runId, decision);
        const run = await getRun(runId);
        setState((s) => ({ ...s, selectedRun: run, view: "run", loading: false }));
      } catch (e) {
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    },
    []
  );

  const goBack = useCallback(() => {
    setState((s) => ({ ...s, view: "boards", error: null }));
  }, []);

  if (state.error) {
    return (
      <div style={styles.errorContainer}>
        <h2>Error</h2>
        <p>{state.error}</p>
        <button onClick={loadBoards} style={styles.button}>
          Retry
        </button>
      </div>
    );
  }

  switch (state.view) {
    case "boards":
      return (
        <div style={styles.page}>
          <h1>Patchbay</h1>
          <p>Local-first agent board engine</p>
          <BoardList boards={state.boards} onSelect={selectBoard} />
        </div>
      );
    case "board":
      if (!state.selectedBoard) return <div>Board not found</div>;
      return (
        <div style={styles.page}>
          <button onClick={goBack} style={styles.backButton}>
            &larr; Back to boards
          </button>
          <h2>{state.selectedBoard.name}</h2>
          <p>
            {state.selectedBoard.tiles.length} tiles &bull;
            {state.selectedBoard.wires.length} wires
          </p>
          <BoardCanvas board={state.selectedBoard} />
          <div style={styles.actions}>
            <button
              onClick={() => runBoard(state.selectedBoard!.id)}
              disabled={state.loading}
              style={styles.runButton}
            >
              {state.loading ? "Running..." : "Run board"}
            </button>
          </div>
        </div>
      );
    case "run":
      if (!state.selectedRun || !state.selectedBoard) return <div>Run not found</div>;
      return (
        <div style={styles.page}>
          <button onClick={goBack} style={styles.backButton}>
            &larr; Back to board
          </button>
          <h2>Run: {state.selectedBoard.name}</h2>
          <RunView run={state.selectedRun} board={state.selectedBoard} />
          {state.selectedRun.status === "paused" && (
            <ApprovalRequest
              runId={state.selectedRun.runId}
              onDecide={decision => approve(state.selectedRun!.runId, decision)}
            />
          )}
        </div>
      );
    case "approval":
      if (!state.selectedRun) return <div>Run not found</div>;
      return (
        <div style={styles.page}>
          <button onClick={goBack} style={styles.backButton}>
            &larr; Back
          </button>
          <h2>Approval Required</h2>
          <ApprovalRequest
            runId={state.selectedRun.runId}
            onDecide={decision => approve(state.selectedRun.runId, decision)}
          />
        </div>
      );
    default:
      return <div>Unknown view</div>;
  }
}

const styles: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto", padding: 24 },
  errorContainer: { fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto", padding: 24, color: "#ef4444" },
  button: {
    background: "#2563eb",
    color: "#fff",
    border: "none",
    padding: "8px 16px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 14,
  },
  backButton: {
    background: "#f1f5f9",
    color: "#334155",
    border: "1px solid #cbd5e1",
    padding: "6px 12px",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 14,
    marginBottom: 16,
  },
  actions: { marginTop: 24, display: "flex", gap: 12 },
  runButton: {
    background: "#16a34a",
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 16,
    fontWeight: 600,
  },
};

export default App;
