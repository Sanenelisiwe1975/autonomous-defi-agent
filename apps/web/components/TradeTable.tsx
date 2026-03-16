"use client";

interface Trade {
  id: number;
  actionType: string;
  txHash: string | null;
  feeEth: string | null;
  success: boolean;
  error: string | null;
  executedAt: string;
}

interface Props {
  trades: Trade[];
}

const ACTION_COLORS: Record<string, string> = {
  ENTER_MARKET: "var(--accent-green)",
  EXIT_MARKET: "var(--accent-blue)",
  REBALANCE: "var(--accent-yellow)",
  HOLD: "var(--text-muted)",
};

export function TradeTable({ trades }: Props) {
  if (trades.length === 0) {
    return (
      <div
        style={{
          padding: "32px",
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: 13,
          border: "1px dashed var(--border)",
          borderRadius: 8,
        }}
      >
        No trades executed yet — agent is warming up
      </div>
    );
  }

  const tdStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-secondary)",
    verticalAlign: "middle",
  };

  const thStyle: React.CSSProperties = {
    padding: "8px 14px",
    textAlign: "left",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    borderBottom: "1px solid var(--border)",
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Action</th>
            <th style={thStyle}>Tx Hash</th>
            <th style={thStyle}>Fee (ETH)</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Time</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} style={{ transition: "background 0.15s" }}>
              <td style={tdStyle}>
                <span
                  style={{
                    color: ACTION_COLORS[t.actionType] ?? "var(--text-secondary)",
                    fontWeight: 600,
                  }}
                >
                  {t.actionType}
                </span>
              </td>
              <td style={tdStyle}>
                {t.txHash ? (
                  <code style={{ fontSize: 11, color: "var(--accent-blue)" }}>
                    {t.txHash.slice(0, 10)}…{t.txHash.slice(-6)}
                  </code>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>—</span>
                )}
              </td>
              <td style={tdStyle}>
                {t.feeEth ?? <span style={{ color: "var(--text-muted)" }}>—</span>}
              </td>
              <td style={tdStyle}>
                <span
                  style={{
                    color: t.success ? "var(--accent-green)" : "var(--accent-red)",
                    fontWeight: 600,
                  }}
                >
                  {t.success ? "OK" : t.error ?? "FAILED"}
                </span>
              </td>
              <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                {new Date(t.executedAt).toLocaleTimeString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
