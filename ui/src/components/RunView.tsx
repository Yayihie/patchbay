import React from "react";
import type { Run, Step, BoardFile } from "../types.js";

interface RunViewProps {
  run: Run;
  board: BoardFile;
}

export function RunView(props: RunViewProps) {
  const { run, board } = props;
  return (
    <div style={styles.container}>
      <h3 style={styles.subtitle}>Run Status</h3>
      <div style={styles.statusRow}>
        <span style={styles.statusLabel}>Status:</span>
        <span style={{ ...styles.statusBadge, background: statusColor(run.status), color: "#fff" }}>
          {run.status}
        </span>
      </div>
      <div style={styles.meta}>
        <span>Board: {board.name}</span>
        <span>Steps: {run.steps.length}</span>
      </div>
      <h4 style={styles.h4}>Steps</h4>
      {run.steps.length === 0 ? (
        <p style={styles.empty}>No steps yet.</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>#</th>
              <th style={styles.th}>Tile</th>
              <th style={styles.th}>Decision</th>
              <th style={styles.th}>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {run.steps.map((s) => (
              <tr key={`${s.step}-${s.tileId}`} style={styles.tr}>
                <td style={styles.td}>{s.step}</td>
                <td style={styles.td}>{s.tileId}</td>
                <td style={styles.td}>{s.decision}</td>
                <td style={styles.td}>{s.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function statusColor(status: string) {
  return { running: "#3b82f6", paused: "#f59e0b", completed: "#16a34a", failed: "#dc2626" }[status] ?? "#64748b";
}

const styles: Record<string, React.CSSProperties> = {
  container: { border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginTop: 16, background: "#fff" },
  subtitle: { margin: "0 0 12px 0", color: "#64748b", fontSize: 14 },
  statusRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 },
  statusLabel: { fontSize: 14, color: "#64748b" },
  statusBadge: { padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600 },
  meta: { display: "flex", gap: 24, fontSize: 14, color: "#64748b", marginBottom: 16 },
  h4: { margin: "0 0 8px 0", color: "#334155", fontSize: 16 },
  empty: { color: "#94a3b8", fontStyle: "italic", margin: 0 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "8px", borderBottom: "2px solid #e2e8f0", color: "#64748b" },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "8px", color: "#334155" },
};
