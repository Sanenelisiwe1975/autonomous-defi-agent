"use client";

interface Props {
  status: "RUNNING" | "WAITING" | "ERROR" | string;
}

export function StatusBadge({ status }: Props) {
  const colors: Record<string, string> = {
    RUNNING: "var(--accent-green)",
    WAITING: "var(--accent-yellow)",
    ERROR: "var(--accent-red)",
  };
  const color = colors[status] ?? "var(--text-muted)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 10px",
        borderRadius: "20px",
        background: `${color}20`,
        border: `1px solid ${color}40`,
        color,
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          animation: status === "RUNNING" ? "pulse 2s infinite" : "none",
        }}
      />
      {status}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </span>
  );
}
