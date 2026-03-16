"use client";

import { useState } from "react";

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

const ACTION_CONFIG: Record<string, { color: string; glyph: string }> = {
  ENTER_MARKET: { color: "#00e676", glyph: "▲" },
  EXIT_MARKET:  { color: "#40c4ff", glyph: "▼" },
  REBALANCE:    { color: "#ffab00", glyph: "⇄" },
  HOLD:         { color: "#3a3a3a", glyph: "◆" },
};

function TxHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span
      onClick={copy}
      title={hash}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        cursor: "pointer",
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
        fontSize: 11,
        color: copied ? "#00e676" : "#40c4ff",
        letterSpacing: "0.04em",
        transition: "color 0.2s",
      }}
    >
      {copied ? "COPIED" : `${hash.slice(0, 8)}…${hash.slice(-5)}`}
      <span style={{ fontSize: 8, opacity: 0.4 }}>⧉</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      padding: "40px 0",
      border: "1px dashed #1a1a1a",
      borderRadius: 4,
    }}>
      <svg width="32" height="20" viewBox="0 0 32 20" fill="none">
        <rect x="0"  y="14" width="4" height="6"  fill="#1e1e1e" />
        <rect x="7"  y="8"  width="4" height="12" fill="#1e1e1e" />
        <rect x="14" y="10" width="4" height="10" fill="#1e1e1e" />
        <rect x="21" y="4"  width="4" height="16" fill="#1e1e1e" />
        <rect x="28" y="11" width="4" height="9"  fill="#1e1e1e" />
      </svg>
      <span style={{
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
        fontSize: 10,
        letterSpacing: "0.16em",
        color: "#2a2a2a",
      }}>
        NO TRADES — AGENT WARMING UP
      </span>
    </div>
  );
}

const COLS = ["ACTION", "TX HASH", "FEE (ETH)", "STATUS", "TIME"] as const;

export function TradeTable({ trades }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (trades.length === 0) return <EmptyState />;

  return (
    <>
      <style>{`
        @keyframes tt-fadein {
          from { opacity: 0; transform: translateX(-4px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .tt-row {
          animation: tt-fadein 0.25s ease both;
        }
      `}</style>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e1e1e" }}>
              {COLS.map((col) => (
                <th
                  key={col}
                  style={{
                    padding: "6px 14px 10px",
                    textAlign: "left",
                    fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
                    fontSize: 9,
                    fontWeight: 500,
                    letterSpacing: "0.2em",
                    color: "#2e2e2e",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => {
              const action   = ACTION_CONFIG[t.actionType] ?? { color: "#4a4a4a", glyph: "·" };
              const isHover  = hovered === t.id;

              return (
                <tr
                  key={t.id}
                  className="tt-row"
                  onMouseEnter={() => setHovered(t.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    borderBottom: "1px solid #141414",
                    background: isHover ? "#111111" : "transparent",
                    transition: "background 0.12s",
                    animationDelay: `${Math.min(i * 0.03, 0.3)}s`,
                  }}
                >
                  {/* Action */}
                  <td style={{ padding: "10px 14px", verticalAlign: "middle" }}>
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
                    }}>
                      <span style={{ fontSize: 10, color: action.color, opacity: 0.7 }}>
                        {action.glyph}
                      </span>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.1em",
                        color: action.color,
                      }}>
                        {t.actionType}
                      </span>
                    </span>
                  </td>

                  {/* Tx Hash */}
                  <td style={{ padding: "10px 14px", verticalAlign: "middle" }}>
                    {t.txHash
                      ? <TxHash hash={t.txHash} />
                      : <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#2a2a2a" }}>—</span>
                    }
                  </td>

                  {/* Fee */}
                  <td style={{ padding: "10px 14px", verticalAlign: "middle" }}>
                    {t.feeEth
                      ? (
                        <span style={{
                          fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
                          fontSize: 11,
                          color: "#9e9e9e",
                          letterSpacing: "0.04em",
                        }}>
                          {t.feeEth}
                        </span>
                      )
                      : <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#2a2a2a" }}>—</span>
                    }
                  </td>

                  {/* Status */}
                  <td style={{ padding: "10px 14px", verticalAlign: "middle" }}>
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
                    }}>
                      <span style={{
                        width: 5, height: 5,
                        borderRadius: "50%",
                        background: t.success ? "#00e676" : "#ff1744",
                        boxShadow: t.success ? "0 0 5px #00e67670" : "0 0 5px #ff174470",
                        flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.14em",
                        color: t.success ? "#00e676" : "#ff1744",
                      }}>
                        {t.success ? "OK" : (t.error ?? "FAILED")}
                      </span>
                    </span>
                  </td>

                  {/* Time */}
                  <td style={{ padding: "10px 14px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                    <span style={{
                      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
                      fontSize: 11,
                      color: "#2e2e2e",
                      letterSpacing: "0.06em",
                    }}>
                      {new Date(t.executedAt).toLocaleTimeString("en-US", { hour12: false })}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Row count footer */}
        <div style={{
          paddingTop: 10,
          borderTop: "1px solid #141414",
          marginTop: 2,
          fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
          fontSize: 9,
          letterSpacing: "0.16em",
          color: "#2a2a2a",
          textAlign: "right",
        }}>
          {trades.length} RECORD{trades.length !== 1 ? "S" : ""}
        </div>
      </div>
    </>
  );
}
