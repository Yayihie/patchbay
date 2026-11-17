import React from "react";
import type { BoardFile } from "../types.js";

interface BoardListProps {
  boards: BoardFile[];
  onSelect: (board: BoardFile) => void;
}

export function BoardList(props: BoardListProps) {
  const { boards, onSelect } = props;
  return (
    <div style={styles.container}>
      <h2>Boards</h2>
      {boards.length === 0 ? (
        <p style={styles.empty}>No boards yet. Create one via the API or CLI.</p>
      ) : (
        <ul style={styles.list}>
          {boards.map((b) => (
            <li key={b.id} style={styles.item}>
              <button
                onClick={() => onSelect(b)}
                style={styles.boardButton}
              >
                {b.name}
              </button>
              <span style={styles.meta}>
                {b.tiles.length} tiles &bull; {b.wires.length} wires
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { fontFamily: "system-ui, sans-serif" },
  empty: { color: "#64748b", fontStyle: "italic" },
  list: { listStyle: "none", padding: 0 },
  item: {
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#fff",
  },
  boardButton: {
    background: "#2563eb",
    color: "#fff",
    border: "none",
    padding: "8px 16px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 16,
    fontWeight: 600,
  },
  meta: { color: "#64748b", fontSize: 14 },
};
