"use client";

import { useState, useEffect } from "react";

// ── Palette ────────────────────────────────────────────────────────────────────
// Rose:   #fdf0f0 / #f5d0d0 / #e8a8a8 / #c97070
// Sage:   #f0f5f0 / #cde0cd / #9ec89e / #5f9a5f
// Lavender: #f3f0fb / #ddd5f5 / #b9a8e8 / #7b62c9

// ── Types ──────────────────────────────────────────────────────────────────────

interface Market {
  id: number;
  title: string;
  category: "Politics" | "Crypto" | "Science" | "Sports" | "Macro";
  yesProb: number;
  volume: string;
  closes: string;
  trend: number[];
  hot: boolean;
}

interface Position {
  market: string;
  side: "YES" | "NO";
  shares: number;
  avgPrice: number;
  current: number;
}

// ── Mock Data ──────────────────────────────────────────────────────────────────

const MARKETS: Market[] = [
  { id: 1, title: "ETH surpasses $5,000 before June 2026", category: "Crypto", yesProb: 61, volume: "$2.4M", closes: "Jun 30", trend: [44,48,52,55,58,61], hot: true },
  { id: 2, title: "US Fed cuts rates at least twice in 2026", category: "Macro", yesProb: 74, volume: "$5.1M", closes: "Dec 31", trend: [60,65,68,71,72,74], hot: true },
  { id: 3, title: "First human Mars landing before 2030", category: "Science", yesProb: 18, volume: "$890K", closes: "Dec 31", trend: [22,20,19,21,18,18], hot: false },
  { id: 4, title: "BTC dominance exceeds 60% this quarter", category: "Crypto", yesProb: 47, volume: "$1.7M", closes: "Mar 31", trend: [40,43,45,48,46,47], hot: false },
  { id: 5, title: "AI wins Nobel Prize in Medicine by 2027", category: "Science", yesProb: 33, volume: "$420K", closes: "Dec 31", trend: [28,29,31,33,33,33], hot: false },
  { id: 6, title: "Global inflation drops below 2% average", category: "Macro", yesProb: 52, volume: "$3.2M", closes: "Sep 30", trend: [45,47,50,51,52,52], hot: true },
];

const POSITIONS: Position[] = [
  { market: "ETH surpasses $5,000", side: "YES", shares: 120, avgPrice: 0.54, current: 0.61 },
  { market: "US Fed cuts rates twice", side: "YES", shares: 80, avgPrice: 0.68, current: 0.74 },
  { market: "BTC dominance >60%", side: "NO", shares: 55, avgPrice: 0.58, current: 0.53 },
];

const CATEGORY_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  Crypto:   { bg: "#f3f0fb", text: "#7b62c9", border: "#ddd5f5" },
  Politics: { bg: "#fdf0f0", text: "#c97070", border: "#f5d0d0" },
  Science:  { bg: "#f0f5f0", text: "#5f9a5f", border: "#cde0cd" },
  Sports:   { bg: "#fdf0f0", text: "#c97070", border: "#f5d0d0" },
  Macro:    { bg: "#f0f5f0", text: "#5f9a5f", border: "#cde0cd" },
};

// ── Tiny sparkline SVG ─────────────────────────────────────────────────────────
function Spark({ data, color }: { data: number[]; color: string }) {
  const w = 64, h = 28;
  const min = Math.min(...data), max = Math.max(...data);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <polyline points={pts} stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Probability bar ────────────────────────────────────────────────────────────
function ProbBar({ yes }: { yes: number }) {
  const no = 100 - yes;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", height: 6, borderRadius: 99, overflow: "hidden", gap: 2 }}>
        <div style={{ width: `${yes}%`, background: "#9ec89e", borderRadius: "99px 0 0 99px", transition: "width .4s ease" }} />
        <div style={{ width: `${no}%`, background: "#e8a8a8", borderRadius: "0 99px 99px 0", transition: "width .4s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "#5f9a5f", fontWeight: 500 }}>YES {yes}%</span>
        <span style={{ fontSize: 11, color: "#c97070" }}>NO {no}%</span>
      </div>
    </div>
  );
}

// ── Market Card ────────────────────────────────────────────────────────────────
function MarketCard({ market, onClick }: { market: Market; onClick: () => void }) {
  const cat = CATEGORY_COLOR[market.category];
  const trendUp = market.trend[market.trend.length - 1] >= market.trend[0];

  return (
    <div
      onClick={onClick}
      style={{
        background: "#fff",
        border: "1px solid #ede8e8",
        borderRadius: 16,
        padding: "20px 22px",
        cursor: "pointer",
        transition: "transform .15s ease, box-shadow .15s ease",
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.06)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}
    >
      {market.hot && (
        <div style={{ position: "absolute", top: 14, right: 14, background: "#fdf0f0", border: "1px solid #f5d0d0", borderRadius: 99, padding: "2px 8px", fontSize: 10, color: "#c97070", fontWeight: 500 }}>
          Trending
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
        <span style={{ background: cat.bg, border: `1px solid ${cat.border}`, borderRadius: 99, padding: "3px 10px", fontSize: 11, color: cat.text, fontWeight: 500, flexShrink: 0 }}>
          {market.category}
        </span>
      </div>
      <p style={{ fontSize: 14, fontWeight: 500, color: "#2a2020", lineHeight: 1.45, marginBottom: 16, fontFamily: "'DM Serif Display', Georgia, serif" }}>
        {market.title}
      </p>
      <ProbBar yes={market.yesProb} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
        <div style={{ display: "flex", gap: 16 }}>
          <span style={{ fontSize: 11, color: "#b8aeae" }}>Vol {market.volume}</span>
          <span style={{ fontSize: 11, color: "#b8aeae" }}>Closes {market.closes}</span>
        </div>
        <Spark data={market.trend} color={trendUp ? "#9ec89e" : "#e8a8a8"} />
      </div>
    </div>
  );
}

// ── Position Row ───────────────────────────────────────────────────────────────
function PositionRow({ pos }: { pos: Position }) {
  const pnl = (pos.current - pos.avgPrice) * pos.shares;
  const pnlPct = ((pos.current - pos.avgPrice) / pos.avgPrice) * 100;
  const up = pnl >= 0;
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f5f0f0", gap: 12 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: pos.side === "YES" ? "#f0f5f0" : "#fdf0f0",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 600,
        color: pos.side === "YES" ? "#5f9a5f" : "#c97070",
      }}>
        {pos.side}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "#2a2020", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pos.market}</p>
        <p style={{ fontSize: 11, color: "#b8aeae", marginTop: 2 }}>{pos.shares} shares · avg {(pos.avgPrice * 100).toFixed(0)}¢</p>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: up ? "#5f9a5f" : "#c97070" }}>
          {up ? "+" : ""}${pnl.toFixed(2)}
        </p>
        <p style={{ fontSize: 11, color: up ? "#9ec89e" : "#e8a8a8", marginTop: 2 }}>
          {up ? "+" : ""}{pnlPct.toFixed(1)}%
        </p>
      </div>
    </div>
  );
}

// ── Agent Log ─────────────────────────────────────────────────────────────────
const LOG_ENTRIES = [
  { time: "14:32", action: "Bought 40 YES shares", market: "ETH $5K", price: "61¢", color: "#5f9a5f", bg: "#f0f5f0" },
  { time: "14:28", action: "Resolved: Fed pivot Q1", market: "Macro hedge", price: "+$220", color: "#7b62c9", bg: "#f3f0fb" },
  { time: "14:15", action: "Sold 20 NO shares", market: "BTC dominance", price: "53¢", color: "#c97070", bg: "#fdf0f0" },
  { time: "13:58", action: "Opened position", market: "Global inflation", price: "52¢", color: "#5f9a5f", bg: "#f0f5f0" },
  { time: "13:40", action: "Rebalanced portfolio", market: "3 markets", price: "—", color: "#7b62c9", bg: "#f3f0fb" },
];

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PredictionMarketsPage() {
  const [activeTab, setActiveTab] = useState<"markets" | "portfolio" | "agent">("markets");
  const [filter, setFilter] = useState<string>("All");
  const [selected, setSelected] = useState<Market | null>(null);
  const [agentActive, setAgentActive] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 4000);
    return () => clearInterval(id);
  }, []);

  const categories = ["All", "Crypto", "Macro", "Science", "Politics", "Sports"];
  const filtered = filter === "All" ? MARKETS : MARKETS.filter(m => m.category === filter);

  const totalPnl = POSITIONS.reduce((sum, p) => sum + (p.current - p.avgPrice) * p.shares, 0);
  const portfolioValue = POSITIONS.reduce((sum, p) => sum + p.current * p.shares, 0);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: #fdf9f7;
          color: #2a2020;
          font-family: 'DM Sans', system-ui, sans-serif;
          min-height: 100vh;
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @keyframes pulse-ring {
          0%   { transform: scale(1);   opacity: .5; }
          100% { transform: scale(2.2); opacity: 0;  }
        }

        .card-grid > * {
          animation: fadeUp .35s ease both;
        }
        .card-grid > *:nth-child(1) { animation-delay: .04s; }
        .card-grid > *:nth-child(2) { animation-delay: .08s; }
        .card-grid > *:nth-child(3) { animation-delay: .12s; }
        .card-grid > *:nth-child(4) { animation-delay: .16s; }
        .card-grid > *:nth-child(5) { animation-delay: .20s; }
        .card-grid > *:nth-child(6) { animation-delay: .24s; }

        .tab-btn {
          padding: 7px 16px;
          border-radius: 99px;
          border: 1px solid transparent;
          background: transparent;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          cursor: pointer;
          color: #9a8e8e;
          transition: all .15s ease;
          font-weight: 400;
        }
        .tab-btn:hover { color: #5a4a4a; }
        .tab-btn.active {
          background: #fff;
          border-color: #ede8e8;
          color: #2a2020;
          font-weight: 500;
        }

        .filter-pill {
          padding: 5px 14px;
          border-radius: 99px;
          border: 1px solid #ede8e8;
          background: #fff;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          cursor: pointer;
          color: #9a8e8e;
          transition: all .15s;
          font-weight: 400;
        }
        .filter-pill:hover { border-color: #cde0cd; color: #5f9a5f; }
        .filter-pill.active {
          background: #f0f5f0;
          border-color: #cde0cd;
          color: #5f9a5f;
          font-weight: 500;
        }

        .place-btn {
          width: 100%;
          padding: 11px;
          border-radius: 10px;
          border: none;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: opacity .15s;
        }
        .place-btn:hover { opacity: .85; }

        .toggle-track {
          width: 36px; height: 20px;
          border-radius: 99px;
          position: relative;
          cursor: pointer;
          transition: background .2s;
          flex-shrink: 0;
        }
        .toggle-thumb {
          position: absolute;
          top: 3px; left: 3px;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #fff;
          transition: left .2s;
        }
      `}</style>

      {/* ── Header ── */}
      <header style={{
        background: "#fff",
        borderBottom: "1px solid #ede8e8",
        padding: "0 32px",
        height: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "#f3f0fb", border: "1px solid #ddd5f5", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="#b9a8e8" strokeWidth="1.5" />
              <polyline points="4,9 6,6 8,7.5 10,4" stroke="#b9a8e8" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 17, color: "#2a2020", letterSpacing: "-.2px" }}>
            Presage
          </span>
          <span style={{ fontSize: 11, color: "#c4b8b8", marginLeft: 2 }}>/ Autonomous Markets</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fdf9f7", border: "1px solid #ede8e8", borderRadius: 99, padding: "4px 6px" }}>
          {(["markets", "portfolio", "agent"] as const).map(t => (
            <button key={t} className={`tab-btn ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Agent status */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", background: agentActive ? "#f0f5f0" : "#fdf0f0", borderRadius: 99, border: `1px solid ${agentActive ? "#cde0cd" : "#f5d0d0"}` }}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              {agentActive && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#9ec89e", animation: "pulse-ring .9s ease-out infinite" }} />}
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: agentActive ? "#5f9a5f" : "#c97070", display: "block", position: "relative" }} />
            </span>
            <span style={{ fontSize: 12, color: agentActive ? "#5f9a5f" : "#c97070", fontWeight: 500 }}>
              Agent {agentActive ? "active" : "paused"}
            </span>
          </div>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#f3f0fb", border: "1px solid #ddd5f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, color: "#7b62c9" }}>
            JA
          </div>
        </div>
      </header>

      <main style={{ padding: "28px 32px", maxWidth: 1200, margin: "0 auto" }}>

        {/* ── Markets Tab ── */}
        {activeTab === "markets" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 24, alignItems: "start" }}>
            <div>
              {/* KPI strip */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
                {[
                  { label: "Open markets", value: "6", sub: "across 5 categories", accent: "#b9a8e8", bg: "#f3f0fb", border: "#ddd5f5" },
                  { label: "Total volume", value: "$13.7M", sub: "all time", accent: "#9ec89e", bg: "#f0f5f0", border: "#cde0cd" },
                  { label: "Avg resolution", value: "84%", sub: "accuracy rate", accent: "#e8a8a8", bg: "#fdf0f0", border: "#f5d0d0" },
                ].map((k, i) => (
                  <div key={i} style={{ background: k.bg, border: `1px solid ${k.border}`, borderRadius: 14, padding: "16px 18px", animation: `fadeUp .3s ease ${i * .06}s both` }}>
                    <p style={{ fontSize: 11, color: k.accent, fontWeight: 500, marginBottom: 6, letterSpacing: ".02em" }}>{k.label.toUpperCase()}</p>
                    <p style={{ fontSize: 26, fontWeight: 400, fontFamily: "'DM Serif Display', Georgia, serif", color: "#2a2020", letterSpacing: "-.5px", lineHeight: 1 }}>{k.value}</p>
                    <p style={{ fontSize: 11, color: "#c4b8b8", marginTop: 5 }}>{k.sub}</p>
                  </div>
                ))}
              </div>

              {/* Filter pills */}
              <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
                {categories.map(c => (
                  <button key={c} className={`filter-pill ${filter === c ? "active" : ""}`} onClick={() => setFilter(c)}>{c}</button>
                ))}
              </div>

              {/* Market grid */}
              <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {filtered.map(m => (
                  <MarketCard key={m.id} market={m} onClick={() => setSelected(selected?.id === m.id ? null : m)} />
                ))}
              </div>
            </div>

            {/* Right panel: selected market OR top movers */}
            <div style={{ position: "sticky", top: 80 }}>
              {selected ? (
                <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px", animation: "fadeUp .2s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                    <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, color: "#2a2020", lineHeight: 1.4, flex: 1, marginRight: 12 }}>{selected.title}</p>
                    <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#c4b8b8", fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>
                  <ProbBar yes={selected.yesProb} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "16px 0" }}>
                    {[
                      { label: "Volume", val: selected.volume },
                      { label: "Closes", val: selected.closes },
                      { label: "Category", val: selected.category },
                      { label: "Liquidity", val: "High" },
                    ].map(r => (
                      <div key={r.label} style={{ background: "#fdf9f7", borderRadius: 10, padding: "10px 12px" }}>
                        <p style={{ fontSize: 10, color: "#c4b8b8", marginBottom: 3 }}>{r.label}</p>
                        <p style={{ fontSize: 13, fontWeight: 500, color: "#2a2020" }}>{r.val}</p>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button className="place-btn" style={{ background: "#f0f5f0", color: "#5f9a5f" }}>
                      Buy YES — {selected.yesProb}¢
                    </button>
                    <button className="place-btn" style={{ background: "#fdf0f0", color: "#c97070" }}>
                      Buy NO — {100 - selected.yesProb}¢
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                  <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, color: "#2a2020", marginBottom: 16 }}>Top movers</p>
                  {[...MARKETS].sort((a, b) => Math.abs(b.trend[b.trend.length-1] - b.trend[0]) - Math.abs(a.trend[a.trend.length-1] - a.trend[0])).slice(0, 4).map(m => {
                    const delta = m.trend[m.trend.length - 1] - m.trend[0];
                    const up = delta >= 0;
                    return (
                      <div key={m.id} onClick={() => setSelected(m)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #f5f0f0", cursor: "pointer" }}>
                        <Spark data={m.trend} color={up ? "#9ec89e" : "#e8a8a8"} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, color: "#2a2020", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title.split(" ").slice(0, 4).join(" ")}…</p>
                          <p style={{ fontSize: 11, color: "#c4b8b8", marginTop: 2 }}>{m.yesProb}% YES</p>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 500, color: up ? "#5f9a5f" : "#c97070" }}>{up ? "+" : ""}{delta}pp</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Portfolio Tab ── */}
        {activeTab === "portfolio" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 24, alignItems: "start" }}>
            <div>
              {/* Summary */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
                {[
                  { label: "Portfolio value", val: `$${portfolioValue.toFixed(2)}`, sub: "current mark", color: "#7b62c9", bg: "#f3f0fb", border: "#ddd5f5" },
                  { label: "Unrealised P&L", val: `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`, sub: "open positions", color: totalPnl >= 0 ? "#5f9a5f" : "#c97070", bg: totalPnl >= 0 ? "#f0f5f0" : "#fdf0f0", border: totalPnl >= 0 ? "#cde0cd" : "#f5d0d0" },
                  { label: "Open positions", val: String(POSITIONS.length), sub: "across 3 markets", color: "#b9a8e8", bg: "#f3f0fb", border: "#ddd5f5" },
                ].map((k, i) => (
                  <div key={i} style={{ background: k.bg, border: `1px solid ${k.border}`, borderRadius: 14, padding: "16px 18px" }}>
                    <p style={{ fontSize: 11, color: k.color, fontWeight: 500, marginBottom: 6 }}>{k.label.toUpperCase()}</p>
                    <p style={{ fontSize: 26, fontFamily: "'DM Serif Display', serif", color: "#2a2020", letterSpacing: "-.5px", lineHeight: 1 }}>{k.val}</p>
                    <p style={{ fontSize: 11, color: "#c4b8b8", marginTop: 5 }}>{k.sub}</p>
                  </div>
                ))}
              </div>

              <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, marginBottom: 16 }}>Open positions</p>
                {POSITIONS.map((p, i) => <PositionRow key={i} pos={p} />)}
              </div>
            </div>

            {/* Allocation breakdown */}
            <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
              <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, marginBottom: 20 }}>Allocation</p>
              {[
                { label: "Crypto", pct: 52, color: "#b9a8e8" },
                { label: "Macro", pct: 32, color: "#9ec89e" },
                { label: "Science", pct: 16, color: "#e8a8a8" },
              ].map(a => (
                <div key={a.label} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: "#5a4a4a" }}>{a.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "#2a2020" }}>{a.pct}%</span>
                  </div>
                  <div style={{ height: 6, background: "#f5f0f0", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${a.pct}%`, background: a.color, borderRadius: 99, transition: "width .5s ease" }} />
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 24, padding: "14px", background: "#f3f0fb", borderRadius: 12, border: "1px solid #ddd5f5" }}>
                <p style={{ fontSize: 11, color: "#7b62c9", fontWeight: 500, marginBottom: 4 }}>WIN RATE</p>
                <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 28, color: "#2a2020" }}>84%</p>
                <p style={{ fontSize: 11, color: "#c4b8b8", marginTop: 2 }}>Last 30 resolved markets</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Agent Tab ── */}
        {activeTab === "agent" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* Config */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16 }}>Agent configuration</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#9a8e8e" }}>{agentActive ? "Running" : "Paused"}</span>
                    <div
                      className="toggle-track"
                      style={{ background: agentActive ? "#9ec89e" : "#e8d8d8" }}
                      onClick={() => setAgentActive(a => !a)}
                    >
                      <div className="toggle-thumb" style={{ left: agentActive ? 19 : 3 }} />
                    </div>
                  </div>
                </div>
                {[
                  { label: "Strategy", val: "Mean reversion + momentum" },
                  { label: "Max position size", val: "$500 per market" },
                  { label: "Rebalance interval", val: "Every 4 hours" },
                  { label: "Risk tolerance", val: "Moderate" },
                  { label: "Categories", val: "Crypto, Macro, Science" },
                  { label: "LLM model", val: "Claude Sonnet 4.6" },
                ].map(r => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f5f0f0", alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: "#9a8e8e" }}>{r.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "#2a2020" }}>{r.val}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: "#f3f0fb", border: "1px solid #ddd5f5", borderRadius: 16, padding: "20px 22px" }}>
                <p style={{ fontSize: 11, color: "#7b62c9", fontWeight: 500, marginBottom: 12 }}>CURRENT REASONING</p>
                <p style={{ fontSize: 13, color: "#4a3a6a", lineHeight: 1.65, fontStyle: "italic" }}>
                  "Macro sentiment is shifting dovish. Increasing YES exposure on rate cut markets. ETH position trending above expected value — holding. Science markets showing mean reversion opportunity at current spreads."
                </p>
                <p style={{ fontSize: 11, color: "#b9a8e8", marginTop: 10 }}>Updated {new Date().toLocaleTimeString()}</p>
              </div>
            </div>

            {/* Activity log */}
            <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16 }}>Activity log</p>
                <span style={{ fontSize: 11, background: "#f0f5f0", border: "1px solid #cde0cd", color: "#5f9a5f", borderRadius: 99, padding: "3px 10px", fontWeight: 500 }}>
                  Live
                </span>
              </div>
              {LOG_ENTRIES.map((e, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: i < LOG_ENTRIES.length - 1 ? "1px solid #f5f0f0" : "none", animation: `fadeUp .3s ease ${i * .06}s both` }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: e.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <polyline points="2,10 5,6 8,7.5 12,3" stroke={e.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: "#2a2020" }}>{e.action}</p>
                    <p style={{ fontSize: 11, color: "#c4b8b8", marginTop: 2 }}>{e.market} · {e.price}</p>
                  </div>
                  <span style={{ fontSize: 11, color: "#c4b8b8", flexShrink: 0 }}>{e.time}</span>
                </div>
              ))}

              {/* Cycle indicator */}
              <div style={{ marginTop: 16, padding: "12px 14px", background: "#fdf9f7", borderRadius: 10, border: "1px solid #ede8e8", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "#9a8e8e" }}>Next cycle in</span>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#2a2020", fontFamily: "'DM Serif Display', serif" }}>
                  {4 - (tick % 4)} cycles
                </span>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
