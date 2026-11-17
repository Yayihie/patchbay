import React, { useState } from "react";
import type { ApprovalRequest } from "../types.js";
import { postApprove } from "../api.js";

interface ApprovalRequestProps {
  runId: string;
  onDecide: (decision: "approve" | "deny") => void;
}

export function ApprovalRequest(props: ApprovalRequestProps) {
  const { runId, onDecide } = props;
  const [deciding, setDeciding] = useState<"approve" | "deny" | null>(null);

  const handleDecide = async (decision: "approve" | "deny") => {
    setDeciding(decision);
    try {
      await postApprove(runId, decision);
      onDecide(decision);
    } catch (e) {
      setDeciding(null);
      alert(`Approval failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const isDeciding = deciding !== null;
  const approveStyle = {
    ...styles.approve,
    ...(deciding === "approve" && styles.deciding),
  };
  const denyStyle = {
    ...styles.deny,
    ...(deciding === "deny" && styles.deciding),
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.subtitle}>Human Approval Required</h3>
      <p style={styles.intro}>
        An irreversible action is paused awaiting your decision. Approving will
        execute the action; rejecting will cancel the run.
      </p>
      <div style={styles.actions}>
        <button
          onClick={() => handleDecide("approve")}
          disabled={isDeciding}
          style={approveStyle}
        >
          {deciding === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          onClick={() => handleDecide("deny")}
          disabled={isDeciding}
          style={denyStyle}
        >
          {deciding === "deny" ? "Denying…" : "Deny"}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: "1px solid #fca5a5",
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
    background: "#fef2f2",
  },
  subtitle: { margin: "0 0 8px 0", color: "#991b1b", fontSize: 16 },
  intro: { margin: "0 0 16px 0", color: "#7f1d1d", fontSize: 14 },
  actions: { display: "flex", gap: 12 },
  approve: {
    background: "#16a34a",
    color: "#fff",
    border: "none",
    padding: "8px 16px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
  },
  deny: {
    background: "#dc2626",
    color: "#fff",
    border: "none",
    padding: "8px 16px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
  },
  deciding: { opacity: 0.6, cursor: "not-allowed" },
};
