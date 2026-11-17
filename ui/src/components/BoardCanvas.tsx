import React from "react";
import type { BoardFile, Tile, Wire } from "../types.js";

interface BoardCanvasProps {
  board: BoardFile;
}

export function BoardCanvas(props: BoardCanvasProps) {
  const { board } = props;
  const tiles = board.tiles as Tile[];
  const wires = board.wires as Wire[];

  return (
    <div style={styles.container}>
      <h3 style={styles.subtitle}>Board Canvas</h3>
      <div style={styles.canvas}>
        {wires.map((w) => (
          <Wire key={w.id} wire={w} tiles={tiles} />
        ))}
        {tiles.map((t) => (
          <Tile key={t.id} tile={t} />
        ))}
      </div>
      <div style={styles.legend}>
        <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #64748b", borderRadius: 2, marginRight: 6 }} />
        Data wire (solid)
        &nbsp;&nbsp;
        <span style={{ display: "inline-block", width: 12, height: 0, borderTop: "2px dashed #64748b", marginRight: 6 }} />
        Permission wire (dashed)
      </div>
    </div>
  );
}

function Wire({ wire, tiles }: { wire: Wire; tiles: Tile[] }) {
  const from = tiles.find((t) => t.id === wire.from);
  const to = tiles.find((t) => t.id === wire.to);
  if (!from || !to) return null;
  return (
    <div style={{ ...styles.wire, borderStyle: wire.kind === "permission" ? "dashed" : "solid" }} title={`from ${from.name} to ${to.name} (${wire.kind})`} />
  );
}

function Tile({ tile }: { tile: Tile }) {
  const risk = (tile as { risk?: string }).risk ?? "read";
  return (
    <div
      style={{
        ...styles.tile,
        background: riskColor(risk),
      }}
      title={`${tile.name} (${tile.kind}, ${risk})`}
    >
      {tile.name}
    </div>
  );
}

function riskColor(risk: string) {
  return { read: "#dcfce7", write: "#fef3c7", irreversible: "#fee2e2" }[risk] ?? "#e2e8f0";
}

const styles: Record<string, React.CSSProperties> = {
  container: { border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginTop: 16, background: "#fff" },
  subtitle: { margin: "0 0 12px 0", color: "#64748b", fontSize: 14 },
  canvas: { display: "flex", flexWrap: "wrap", gap: 12, minHeight: 200 },
  wire: {
    width: 0,
    height: 0,
    borderLeft: "2px solid transparent",
    borderRight: "2px solid transparent",
    borderBottom: "4px solid #94a3b8",
    margin: "4px auto",
  },
  tile: {
    padding: "8px 12px",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    color: "#0f172a",
    border: "1px solid rgba(0,0,0,0.1)",
  },
  legend: { marginTop: 12, fontSize: 13, color: "#64748b", display: "flex", gap: 16, alignItems: "center" },
};
