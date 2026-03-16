"use client";

interface Props {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}

export function MetricCard({ label, value, sub, accent = "var(--accent-green)" }: Props) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ color: accent, fontSize: 26, fontWeight: 700, letterSpacing: "-0.5px" }}>
        {value}
      </div>
      {sub && (
        <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{sub}</div>
      )}
    </div>
  );
}
