/**
 * @file app/dashboard/page.tsx
 * @description Real-time autonomous agent dashboard.
 * Polls /api/agent, /api/portfolio, /api/trades every 10s.
 */
"use client";

import { useEffect, useState, useCallback } from "react";
import { MetricCard } from "../../components/MetricCard";
import { StatusBadge } from "../../components/StatusBadge";
import { PortfolioChart } from "../../components/PortfolioChart";
import { TradeTable } from "../../components/TradeTable";

// ── Types ──────────────────────────────────────────────────────────────────────

interface AgentState {
  iteration: number;
  network: string;
  status: "RUNNING" | "WAITING" | "ERROR";
  lastCycleMs: number;
  marketSentiment: string;
  updatedAt: string;
  portfolio?: {
    address: string;
    ethWei: string;
    usdtMicro: string;
    xautMicro: string;
    totalValueUsdt: string;
    snapshotAt: number;
  };
  executions?: Array<{
    actionType: string;
    success: boolean;
    txHash?: string;
    skipped: boolean;
  }>;
}

interface PortfolioSnapshot {
  id: number;
  snapshotAt: string;
  totalUsdt: string;
  usdtBalance: string;
  xautBalance: string;
  ethBalance: string;
}

interface Trade {
  id: number;
  actionType: string;
  txHash: string | null;
  feeEth: string | null;
  success: boolean;
  error: string | null;
  executedAt: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function microUsdtToDisplay(micro: string | undefined): string {
  if (!micro) return "$0.00";
  return `$${(Number(micro) / 1e6).toFixed(2)}`;
}

function weiToEth(wei: string | undefined): string {
  if (!wei) return "0.000000";
  return (Number(wei) / 1e18).toFixed(6);
}

const SENTIMENT_COLOR: Record<string, string> = {
  BULLISH: "var(--accent-green)",
  BEARISH: "var(--accent-red)",
  NEUTRAL: "var(--accent-yellow)",
  VOLATILE: "var(--accent-blue)",
};

export default function DashboardPage() {
  const [agent, setAgent] = useState<AgentState | null>(null);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [agentData, portfolioData, tradesData] = await Promise.all([
        fetchJson<AgentState>("/api/agent"),
        fetchJson<{ snapshots: PortfolioSnapshot[] }>("/api/portfolio"),
        fetchJson<{ trades: Trade[] }>("/api/trades"),
      ]);
      setAgent(agentData);
      setSnapshots(portfolioData.snapshots);
      setTrades(tradesData.trades);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch error");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const portfolio = agent?.portfolio;
  const sentimentColor = SENTIMENT_COLOR[agent?.marketSentiment ?? "NEUTRAL"] ?? "var(--text-muted)";

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--text-primary)" }}>
      <header style={{
        borderBottom: "1px solid var(--border)",
        padding: "0 32px",
        height: 64,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--surface)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--tether-green)", letterSpacing: "-0.3px" }}>
              DeFi Agent
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em" }}>
              TETHER WDK · {agent?.network?.toUpperCase() ?? "SEPOLIA"}
            </span>
          </div>
          {agent && <StatusBadge status={agent.status} />}
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Cycle #{agent?.iteration ?? 0}</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Updated {lastRefresh?.toLocaleTimeString() ?? ""}</span>
        </div>
      </header>

      {error && (
        <div style={{
          background: "var(--accent-red-dim)",
          border: "1px solid var(--accent-red)",
          borderRadius: 8,
          margin: "16px 32px 0",
          padding: "10px 16px",
          fontSize: 13,
          color: "var(--accent-red)",
        }}>
          {error}
        </div>
      )}

      <main style={{ padding: "24px 32px", maxWidth: 1280, margin: "0 auto" }}>
        {portfolio?.address && (
          <div style={{
            marginBottom: 24, padding: "12px 16px",
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Agent Wallet
            </span>
            <code style={{ fontSize: 13, color: "var(--tether-green)" }}>{portfolio.address}</code>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 32 }}>
          <MetricCard label="Total Portfolio" value={microUsdtToDisplay(portfolio?.totalValueUsdt)} sub="USD₮ equivalent" accent="var(--tether-green)" />
          <MetricCard label="USD₮ Balance" value={microUsdtToDisplay(portfolio?.usdtMicro)} sub="Base trading asset" accent="var(--accent-green)" />
          <MetricCard label="XAU₮ Balance" value={`${portfolio ? (Number(portfolio.xautMicro) / 1e6).toFixed(4) : "0"} XAU₮`} sub="Gold hedge reserve" accent="var(--accent-yellow)" />
          <MetricCard label="ETH (gas)" value={`${weiToEth(portfolio?.ethWei)} ETH`} sub="For transaction fees" accent="var(--accent-blue)" />
          <MetricCard label="Sentiment" value={agent?.marketSentiment ?? "—"} sub="OpenClaw LLM view" accent={sentimentColor} />
          <MetricCard label="Last Cycle" value={agent?.lastCycleMs ? `${(agent.lastCycleMs / 1000).toFixed(1)}s` : "—"} sub="Loop duration" accent="var(--text-secondary)" />
        </div>

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 16, letterSpacing: "0.05em" }}>
            PORTFOLIO VALUE — USD₮
          </h2>
          <PortfolioChart snapshots={snapshots} />
        </section>

        {(agent?.executions?.length ?? 0) > 0 && (
          <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px", marginBottom: 24 }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 16, letterSpacing: "0.05em" }}>
              CURRENT CYCLE — EXECUTIONS
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {agent!.executions!.map((e, i) => (
                <span key={i} style={{
                  padding: "6px 12px", borderRadius: 6, fontSize: 12,
                  background: e.success ? "var(--accent-green-dim)" : "var(--accent-red-dim)",
                  border: `1px solid ${e.success ? "var(--accent-green)" : "var(--accent-red)"}40`,
                  color: e.success ? "var(--accent-green)" : "var(--accent-red)",
                }}>
                  {e.actionType}{e.skipped ? " (skip)" : ""}
                </span>
              ))}
            </div>
          </section>
        )}

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 16, letterSpacing: "0.05em" }}>
            TRADE HISTORY
          </h2>
          <TradeTable trades={trades} />
        </section>
      </main>
    </div>
  );
}
