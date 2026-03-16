"use client";

interface Props {
  status: "RUNNING" | "WAITING" | "ERROR" | string;
}

const STATUS_CONFIG: Record<string, { color: string; glyph: string; label: string }> = {
  RUNNING: { color: "#00e676", glyph: "▶", label: "RUNNING" },
  WAITING: { color: "#ffab00", glyph: "◼", label: "WAITING" },
  ERROR:   { color: "#ff1744", glyph: "✕", label: "ERROR"   },
};

export function StatusBadge({ status }: Props) {
  const conf  = STATUS_CONFIG[status] ?? { color: "#4a4a4a", glyph: "?", label: status };
  const isRun = status === "RUNNING";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "4px 10px",
        borderRadius: 3,
        background: `${conf.color}0c`,
        border: `1px solid ${conf.color}28`,
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      }}
    >
      <style>{`
        @keyframes sb-ping {
          0%, 100% { transform: scale(1);   opacity: 0.35; }
          50%       { transform: scale(2.4); opacity: 0; }
        }
        @keyframes sb-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
      `}</style>

      {/* Dot with optional ping ring */}
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 10, height: 10, flexShrink: 0 }}>
        {isRun && (
          <span style={{
            position: "absolute",
            width: 10, height: 10,
            borderRadius: "50%",
            background: conf.color,
            animation: "sb-ping 1.6s ease-in-out infinite",
          }} />
        )}
        <span style={{
          width: 5, height: 5,
          borderRadius: "50%",
          background: conf.color,
          boxShadow: `0 0 ${isRun ? "6px" : "0px"} ${conf.color}`,
          flexShrink: 0,
          transition: "box-shadow 0.3s",
        }} />
      </span>

      {/* Glyph */}
      <span style={{
        fontSize: 8,
        color: conf.color,
        opacity: 0.6,
        animation: status === "ERROR" ? "sb-blink 1s step-start infinite" : "none",
      }}>
        {conf.glyph}
      </span>

      {/* Label */}
      <span style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.16em",
        color: conf.color,
      }}>
        {conf.label}
      </span>
    </span>
  );
}
