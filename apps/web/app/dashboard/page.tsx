"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { TradeTable } from "../../components/TradeTable";
import { PortfolioChart } from "../../components/PortfolioChart";
import { metadata } from '../layout';


interface AgentState {
  iteration: number;
  network: string;
  portfolio: { address: string; ethWei: string; usdtMicro: string; xautMicro: string; totalValueUsdt: string; snapshotAt: number } | null;
  lastCycleMs: number;
  executions: { actionId: string; actionType: string; success: boolean; txHash?: string; feeWei?: string; error?: string; skipped: boolean; executedAt: string }[];
  marketSentiment: string;
  reasoning: string;
  summary: string;
  gasGwei: string | null;
  updatedAt: string;
  status: "RUNNING" | "WAITING";
}

interface ConditionalPayment {
  id: string;
  creator: string;
  beneficiary: string;
  marketId: string;
  question: string | null;
  amountUsdt: string;
  triggerOutcome: string;
  status: "PENDING" | "CLAIMED" | "REFUNDED";
}

interface LiveMarket {
  address: string;
  question: string;
  yesProbability: number;
  closesAt: string;
  daysLeft: number;
  volumeUsdt: string;
  tradeable: boolean;
  resolvedOutcome: number;
  agentYesUsdt: string | null;
  agentNoUsdt:  string | null;
}

interface VaultState {
  vaultUsdt: string;
  agentUsdt: string;
  dailyLimit: string;
  dailyUsed: string;
  remainingDaily: string;
  agentAddress: string;
}

interface Resolution {
  marketAddress: string;
  marketId: string;
  question: string;
  proposed: boolean;
  outcome: string;
  source: string;
  resolvedBy: string;
  finalized: boolean;
  rationale: string | null;
  proposedAt: string | null;
  disputeWindowEnds: string | null;
}

interface SubscriptionPlan {
  id: number;
  name: string;
  priceUsdt: string;
  periodDays: number;
  active: boolean;
}

interface SubscriptionState {
  contractAddress: string;
  activeSubscribers: number;
  totalRevenue: string;
  plans: SubscriptionPlan[];
}

interface PortfolioSnapshot {
  id: number;
  address: string;
  ethBalance: string;
  usdtBalance: string;
  xautBalance: string;
  totalUsdt: string;
  snapshotAt: string;
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


interface Market {
  id: number | string;
  title: string;
  category: string;
  yesProb: number;
  volume: string;
  volumeRaw: number;
  closes: string;
  daysLeft: number;
  trend: number[];
  hot: boolean;
  address?: string;
  agentYesUsdt: string | null;
  agentNoUsdt:  string | null;
}

const MOCK_MARKETS: Market[] = [
  { id: 1, title: "ETH surpasses $5,000 before June 2026",   category: "Crypto",  yesProb: 61, volume: "$2.4M",  volumeRaw: 2400000, closes: "Jun 30", daysLeft: 103, trend: [44,48,52,55,58,61], hot: true,  agentYesUsdt: null, agentNoUsdt: null },
  { id: 2, title: "US Fed cuts rates at least twice in 2026", category: "Macro",   yesProb: 74, volume: "$5.1M",  volumeRaw: 5100000, closes: "Dec 31", daysLeft: 287, trend: [60,65,68,71,72,74], hot: true,  agentYesUsdt: "50.00", agentNoUsdt: null },
  { id: 3, title: "First human Mars landing before 2030",     category: "Science", yesProb: 18, volume: "$890K",  volumeRaw: 890000,  closes: "Dec 31", daysLeft: 287, trend: [22,20,19,21,18,18], hot: false, agentYesUsdt: null, agentNoUsdt: null },
  { id: 4, title: "BTC dominance exceeds 60% this quarter",   category: "Crypto",  yesProb: 47, volume: "$1.7M",  volumeRaw: 1700000, closes: "Mar 31", daysLeft: 13,  trend: [40,43,45,48,46,47], hot: false, agentYesUsdt: null, agentNoUsdt: "25.00" },
  { id: 5, title: "AI wins Nobel Prize in Medicine by 2027",  category: "Science", yesProb: 33, volume: "$420K",  volumeRaw: 420000,  closes: "Dec 31", daysLeft: 287, trend: [28,29,31,33,33,33], hot: false, agentYesUsdt: null, agentNoUsdt: null },
  { id: 6, title: "Global inflation drops below 2% average",  category: "Macro",   yesProb: 52, volume: "$3.2M",  volumeRaw: 3200000, closes: "Sep 30", daysLeft: 195, trend: [45,47,50,51,52,52], hot: true,  agentYesUsdt: null, agentNoUsdt: null },
];

const CATEGORY_KEYWORDS: [string, RegExp][] = [
  ["Crypto",   /\b(btc|eth|bitcoin|ethereum|crypto|defi|nft|token|solana|usdt|stablecoin|blockchain)\b/],
  ["Macro",    /\b(fed|federal reserve|rate|gdp|inflation|recession|macro|dollar|treasury|economy|central bank|ecb|cpi)\b/],
  ["Politics", /\b(election|president|congress|senate|vote|poll|government|policy|war|ukraine|china|parliament|referendum)\b/],
  ["Science",  /\b(ai|artificial intelligence|science|nasa|mars|space|research|gene|medicine|climate|physics|cern|nobel|fusion|vaccine)\b/],
  ["Sports",   /\b(nba|nfl|soccer|world cup|champion|sport|tennis|cricket|football|basketball|formula|olympic|f1)\b/],
];


function deriveCategory(question: string): string {
  const q = question.toLowerCase();
  for (const [cat, re] of CATEGORY_KEYWORDS) {
    if (re.test(q)) return cat;
  }
  return "Other";
}

// ── FIX 2: deterministic trend — no Math.random() ────────────────────────────
// Original used Math.random(), causing sparklines to re-roll on every render
// and cards to flicker. We seed from the market address instead.

function deterministicTrend(seed: string, yesProb: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) >>> 0;
  }
  return Array.from({ length: 6 }, (_, k) => {
    h = (Math.imul(1664525, h) + 1013904223) >>> 0;
    const jitter = ((h & 0xff) / 255) * 6 - 3;
    return Math.max(1, Math.min(99, Math.round(yesProb + (k - 3) * 2 + jitter)));
  });
}


function liveToMarket(m: LiveMarket,): Market {
  const yesProb    = Math.round(m.yesProbability * 100);
  const closes     = new Date(m.closesAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const volumeRaw  = Number(m.volumeUsdt);
  const volume    = volumeRaw >= 1_000_000 ? `$${(volumeRaw / 1_000_000).toFixed(1)}M`
    : volumeRaw >= 1_000 ? `$${(volumeRaw / 1_000).toFixed(0)}K`
    : `$${volumeRaw.toFixed(0)}`;

  const category   = deriveCategory(m.question);
  const trend      = deterministicTrend(m.address, yesProb);
  const hasAgentPos = m.agentYesUsdt !== null || m.agentNoUsdt !== null;
  return {
    id: m.address, title: m.question, category,
    yesProb, volume, volumeRaw, closes, daysLeft: m.daysLeft ?? 0,
    trend, hot: hasAgentPos, address: m.address,
    agentYesUsdt: m.agentYesUsdt, agentNoUsdt: m.agentNoUsdt,
  };
}

const CATEGORY_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  Crypto:   { bg: "#f3f0fb", text: "#7b62c9", border: "#ddd5f5" },
  Politics: { bg: "#fdf0f0", text: "#c97070", border: "#f5d0d0" },
  Science:  { bg: "#f0f5f0", text: "#5f9a5f", border: "#cde0cd" },
  Sports:   { bg: "#fdf0f0", text: "#c97070", border: "#f5d0d0" },
  Macro:    { bg: "#f0f5f0", text: "#5f9a5f", border: "#cde0cd" },
  Other:    { bg: "#f5f5f5", text: "#888888", border: "#e0e0e0" },
};

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

function ProbBar({ yes }: { yes: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ height: 5, borderRadius: 99, overflow: "hidden", display: "flex", gap: 2 }}>
        <div style={{ width: `${yes}%`, background: "#9ec89e", transition: "width .4s ease" }} />
        <div style={{ flex: 1, background: "#e8a8a8" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "#5f9a5f", fontWeight: 600 }}>YES {yes}%</span>
        <span style={{ fontSize: 12, color: "#c97070", fontWeight: 600 }}>NO {100 - yes}%</span>
      </div>
    </div>
  );
}

function MarketCard({ market, onClick }: { market: Market; onClick: () => void }) {
  const cat      = CATEGORY_COLOR[market.category] ?? { bg: "#f5f5f5", text: "#888888", border: "#e0e0e0" };
  const trendUp  = (market.trend[market.trend.length - 1] ?? 0) >= (market.trend[0] ?? 0);
  const yesPrice = (market.yesProb / 100).toFixed(2);
  const noPrice  = ((100 - market.yesProb) / 100).toFixed(2);
  const urgency  = market.daysLeft <= 3 ? "#c97070" : market.daysLeft <= 14 ? "#c49a00" : "#b8aeae";
  const hasAgentPos = market.agentYesUsdt || market.agentNoUsdt;

  return (
    <div
      onClick={onClick}
      style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "20px 22px", cursor: "pointer", transition: "transform .15s ease, box-shadow .15s ease", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", gap: 0 }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.07)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}
    >
      {/* Top row: category + badges */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <span style={{ background: cat.bg, border: `1px solid ${cat.border}`, borderRadius: 99, padding: "2px 9px", fontSize: 10, color: cat.text, fontWeight: 600 }}>{market.category}</span>
        {market.hot && <span style={{ background: "#fdf0f0", border: "1px solid #f5d0d0", borderRadius: 99, padding: "2px 8px", fontSize: 10, color: "#c97070", fontWeight: 500 }}>🔥 Hot</span>}
        {hasAgentPos && (
          <span style={{ background: "#f3f0fb", border: "1px solid #ddd5f5", borderRadius: 99, padding: "2px 8px", fontSize: 10, color: "#7b62c9", fontWeight: 600, marginLeft: "auto" }}>
            Agent {market.agentYesUsdt ? `YES $${market.agentYesUsdt}` : `NO $${market.agentNoUsdt}`}
          </span>
        )}
        {!hasAgentPos && market.daysLeft > 0 && (
          <span style={{ fontSize: 10, color: urgency, fontWeight: 500, marginLeft: "auto" }}>
            {market.daysLeft <= 1 ? "Closes today" : `${market.daysLeft}d left`}
          </span>
        )}
      </div>

      {/* Question */}
      <p style={{ fontSize: 14, fontWeight: 500, color: "#2a2020", lineHeight: 1.45, marginBottom: 16, fontFamily: "'DM Serif Display', Georgia, serif", flex: 1 }}>
        {market.title}
      </p>

      {/* Big probability number */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 40, fontWeight: 700, fontFamily: "'DM Serif Display', Georgia, serif", color: market.yesProb >= 50 ? "#5f9a5f" : "#c97070", lineHeight: 1 }}>
          {market.yesProb}%
        </span>
        <span style={{ fontSize: 12, color: "#b8aeae", marginBottom: 6 }}>chance YES</span>
        <div style={{ marginLeft: "auto" }}>
          <Spark data={market.trend} color={trendUp ? "#9ec89e" : "#e8a8a8"} />
        </div>
      </div>

      {/* Probability bar */}
      <div style={{ height: 5, borderRadius: 99, overflow: "hidden", display: "flex", marginBottom: 14, gap: 2 }}>
        <div style={{ width: `${market.yesProb}%`, background: "#9ec89e", transition: "width .4s ease" }} />
        <div style={{ flex: 1, background: "#e8a8a8" }} />
      </div>

      {/* YES / NO price buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, background: "#f0f5f0", border: "1px solid #cde0cd", borderRadius: 10, padding: "8px 0", textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#5f9a5f", fontWeight: 600, marginBottom: 2 }}>YES</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#5f9a5f" }}>${yesPrice}</div>
        </div>
        <div style={{ flex: 1, background: "#fdf0f0", border: "1px solid #f5d0d0", borderRadius: 10, padding: "8px 0", textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#c97070", fontWeight: 600, marginBottom: 2 }}>NO</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#c97070" }}>${noPrice}</div>
        </div>
      </div>

      {/* Footer: volume + closes */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#b8aeae" }}>Vol {market.volume}</span>
        <span style={{ fontSize: 11, color: "#b8aeae" }}>Closes {market.closes}</span>
      </div>
    </div>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const cfg: Record<string, { bg: string; text: string; border: string }> = {
    BULLISH:   { bg: "#f0f5f0", text: "#5f9a5f", border: "#cde0cd" },
    BEARISH:   { bg: "#fdf0f0", text: "#c97070", border: "#f5d0d0" },
    NEUTRAL:   { bg: "#f3f0fb", text: "#7b62c9", border: "#ddd5f5" },
    VOLATILE:  { bg: "#fffbf0", text: "#c49a00", border: "#f0e0a0" },
  };
  const c = cfg[sentiment] ?? cfg["NEUTRAL"]!;
  return (
    <span style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 99, padding: "2px 10px", fontSize: 11, color: c.text, fontWeight: 500 }}>
      {sentiment}
    </span>
  );
}

function ResolutionRow({ r }: { r: Resolution }) {
  const now = Date.now();
  const disputeEnd = r.disputeWindowEnds ? new Date(r.disputeWindowEnds).getTime() : null;
  const inDispute = disputeEnd !== null && now < disputeEnd && !r.finalized;
  const hoursLeft = disputeEnd ? Math.max(0, Math.round((disputeEnd - now) / 3_600_000)) : 0;

  const outcomeColor = r.outcome === "YES" ? "#5f9a5f" : r.outcome === "NO" ? "#c97070" : "#b8aeae";
  const statusBg = r.finalized ? "#f0f5f0" : inDispute ? "#fffbf0" : r.proposed ? "#f3f0fb" : "#fdf9f7";
  const statusText = r.finalized ? "Finalized" : inDispute ? `Dispute (${hoursLeft}h left)` : r.proposed ? "Proposed" : "Pending";
  const statusColor = r.finalized ? "#5f9a5f" : inDispute ? "#c49a00" : r.proposed ? "#7b62c9" : "#b8aeae";

  return (
    <div style={{ padding: "14px 0", borderBottom: "1px solid #f5f0f0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: "#2a2020", lineHeight: 1.4, flex: 1 }}>{r.question}</p>
        <span style={{ background: statusBg, borderRadius: 99, padding: "2px 9px", fontSize: 10, color: statusColor, fontWeight: 500, flexShrink: 0, border: `1px solid ${statusColor}30` }}>{statusText}</span>
      </div>
      {r.proposed && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: r.rationale ? 8 : 0 }}>
          <span style={{ fontSize: 11, color: outcomeColor, fontWeight: 600 }}>→ {r.outcome}</span>
          <span style={{ fontSize: 11, color: "#b8aeae" }}>{r.source}</span>
          {r.proposedAt && <span style={{ fontSize: 11, color: "#b8aeae" }}>{new Date(r.proposedAt).toLocaleString()}</span>}
        </div>
      )}
      {r.rationale && (
        <p style={{ fontSize: 11, color: "#7b62c9", fontStyle: "italic", lineHeight: 1.5, background: "#f9f7fe", borderRadius: 8, padding: "8px 10px", marginTop: 4 }}>
          &ldquo;{r.rationale}&rdquo;
        </p>
      )}
    </div>
  );
}

export default function PredictionMarketsPage() {
  const [activeTab, setActiveTab] = useState<"markets" | "portfolio" | "agent">("markets");
  const [filter, setFilter]   = useState<string>("All");
  const [search, setSearch]   = useState<string>("");
  const [sortBy, setSortBy]   = useState<"volume" | "closes" | "probability" | "trending">("trending");
  const [selected, setSelected] = useState<Market | null>(null);

  const [agentState, setAgentState]           = useState<AgentState | null>(null);
  const [liveMarkets, setLiveMarkets]         = useState<LiveMarket[]>([]);
  const [vaultState, setVaultState]           = useState<VaultState | null>(null);
  const [resolutions, setResolutions]         = useState<Resolution[]>([]);
  const [snapshots, setSnapshots]             = useState<PortfolioSnapshot[]>([]);
  const [trades, setTrades]                   = useState<Trade[]>([]);
  const [conditionalPayments, setConditionalPayments] = useState<ConditionalPayment[]>([]);
  const [subscriptionState, setSubscriptionState]     = useState<SubscriptionState | null>(null);

  const fetchAgent        = useCallback(() => fetch("/api/agent").then(r => r.json()).then(setAgentState).catch(() => {}), []);
  const fetchMarkets      = useCallback(() => fetch("/api/markets").then(r => r.json()).then((d: { markets: LiveMarket[] }) => {
    const incoming = d.markets ?? [];
    if (incoming. length > 0) {
      setFilter(prev => {
        if(prev == "All") return prev;
        const cats = new Set(incoming.map(m => deriveCategory(m.question)));
        return cats.has(prev) ? prev : "All";
      })
    }
  }).catch(()=>{}), []);   
  const fetchVault        = useCallback(() => fetch("/api/vault").then(r => r.json()).then((d: VaultState & { error?: string }) => { if (!d.error) setVaultState(d); }).catch(() => {}), []);
  const fetchRes          = useCallback(() => fetch("/api/resolutions").then(r => r.json()).then((d: { resolutions: Resolution[] }) => setResolutions(d.resolutions ?? [])).catch(() => {}), []);
  const fetchPortfolio    = useCallback(() => fetch("/api/portfolio").then(r => r.json()).then((d: { snapshots: PortfolioSnapshot[] }) => setSnapshots(d.snapshots ?? [])).catch(() => {}), []);
  const fetchTrades       = useCallback(() => fetch("/api/trades").then(r => r.json()).then((d: { trades: Trade[] }) => setTrades(d.trades ?? [])).catch(() => {}), []);
  const fetchConditional  = useCallback(() => fetch("/api/conditional").then(r => r.json()).then((d: { payments: ConditionalPayment[] }) => setConditionalPayments(d.payments ?? [])).catch(() => {}), []);
  const fetchSubscription = useCallback(() => fetch("/api/subscription").then(r => r.json()).then((d: SubscriptionState & { error?: string }) => { if (!d.error) setSubscriptionState(d); }).catch(() => {}), []);

  useEffect(() => {
    void fetchAgent(); void fetchMarkets(); void fetchVault();
    void fetchRes();   void fetchPortfolio(); void fetchTrades();
    void fetchConditional(); void fetchSubscription();

    const agentInterval     = setInterval(() => { void fetchAgent(); void fetchTrades(); }, 10_000);
    const marketInterval    = setInterval(() => { void fetchMarkets(); void fetchRes(); void fetchConditional(); }, 30_000);
    const vaultInterval     = setInterval(fetchVault, 30_000);
    const portfolioInterval = setInterval(fetchPortfolio, 15_000);

    return () => {
      clearInterval(agentInterval); clearInterval(marketInterval);
      clearInterval(vaultInterval); clearInterval(portfolioInterval);
    };
  }, [fetchAgent, fetchMarkets, fetchVault, fetchRes, fetchPortfolio, fetchTrades]);

  const markets = useMemo<Market[]>(
  () =>
    liveMarkets.length > 0
      ? liveMarkets.map(m => liveToMarket(m))
      : MOCK_MARKETS,
  [liveMarkets]
);

  // FIX 7: filter tabs only show categories that exist in current data
  const availableCategories = ["All", "Crypto", "Macro", "Politics", "Science", "Sports", "Other"].filter(cat =>
    cat === "All" || markets.some(m => m.category === cat)
  );

  const filtered = markets
    .filter(m => filter === "All" || m.category === filter)
    .filter(m => !search || m.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "volume")      return b.volumeRaw - a.volumeRaw;
      if (sortBy === "closes")      return a.daysLeft - b.daysLeft;
      if (sortBy === "probability") return Math.abs(b.yesProb - 50) - Math.abs(a.yesProb - 50);
      return (b.hot ? 1 : 0) - (a.hot ? 1 : 0);
    });

  const winRate = (() => {
    const resolved = resolutions.filter(r => r.finalized && r.outcome !== "UNRESOLVED");
    if (resolved.length === 0) return null;
    const correct = resolved.filter(r => {
      const agentTrade = trades.find(t => t.actionType === "ENTER_MARKET");
      return agentTrade && r.proposed;
    }).length;
    return Math.round((correct / resolved.length) * 100);
  })();

  const portfolioPnl = (() => {
    if (snapshots.length < 2) return null;
    const first = Number(snapshots[0]?.totalUsdt ?? 0);
    const last  = Number(snapshots[snapshots.length - 1]?.totalUsdt ?? 0);
    if (first === 0) return null;
    const pct = ((last - first) / first) * 100;
    return { pct: pct.toFixed(1), positive: pct >= 0 };
  })();

  const agentRunning = agentState?.status === "RUNNING";

  const latestSnap  = snapshots[snapshots.length - 1];
  const portfolioVal = latestSnap ? `$${Number(latestSnap.totalUsdt).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
  const usdtBal     = latestSnap ? `$${Number(latestSnap.usdtBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD₮` : "—";
  const xautBal     = latestSnap ? `${Number(latestSnap.xautBalance).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} XAU₮` : "—";

  const chartSnapshots = snapshots.map(s => ({ snapshotAt: s.snapshotAt, totalUsdt: s.totalUsdt }));

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #fdf9f7; color: #2a2020; font-family: 'DM Sans', system-ui, sans-serif; min-height: 100vh; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse-ring { 0% { transform: scale(1); opacity: .5; } 100% { transform: scale(2.2); opacity: 0; } }
        .card-grid > * { animation: fadeUp .35s ease both; }
        .card-grid > *:nth-child(1) { animation-delay: .04s; }
        .card-grid > *:nth-child(2) { animation-delay: .08s; }
        .card-grid > *:nth-child(3) { animation-delay: .12s; }
        .card-grid > *:nth-child(4) { animation-delay: .16s; }
        .card-grid > *:nth-child(5) { animation-delay: .20s; }
        .card-grid > *:nth-child(6) { animation-delay: .24s; }
        .tab-btn { padding: 7px 16px; border-radius: 99px; border: 1px solid transparent; background: transparent; font-family: 'DM Sans', sans-serif; font-size: 13px; cursor: pointer; color: #9a8e8e; transition: all .15s ease; font-weight: 400; }
        .tab-btn:hover { color: #5a4a4a; }
        .tab-btn.active { background: #fff; border-color: #ede8e8; color: #2a2020; font-weight: 500; }
        .filter-pill { padding: 5px 14px; border-radius: 99px; border: 1px solid #ede8e8; background: #fff; font-family: 'DM Sans', sans-serif; font-size: 12px; cursor: pointer; color: #9a8e8e; transition: all .15s; font-weight: 400; }
        .filter-pill:hover { border-color: #cde0cd; color: #5f9a5f; }
        .filter-pill.active { background: #f0f5f0; border-color: #cde0cd; color: #5f9a5f; font-weight: 500; }
        .place-btn { width: 100%; padding: 11px; border-radius: 10px; border: none; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; transition: opacity .15s; }
        .place-btn:hover { opacity: .85; }
      `}</style>

      {/* ── Header ── */}
      <header style={{ background: "#fff", borderBottom: "1px solid #ede8e8", padding: "0 32px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "#f3f0fb", border: "1px solid #ddd5f5", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="#b9a8e8" strokeWidth="1.5" />
              <polyline points="4,9 6,6 8,7.5 10,4" stroke="#b9a8e8" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 17, color: "#2a2020", letterSpacing: "-.2px" }}>Autonomous DeFi Agent</span>
          {agentState && <span style={{ fontSize: 11, color: "#c4b8b8" }}>#{agentState.iteration} · {agentState.network}</span>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fdf9f7", border: "1px solid #ede8e8", borderRadius: 99, padding: "4px 6px" }}>
          {(["markets", "portfolio", "agent"] as const).map(t => (
            <button key={t} className={`tab-btn ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", background: agentRunning ? "#f0f5f0" : "#fdf0f0", borderRadius: 99, border: `1px solid ${agentRunning ? "#cde0cd" : "#f5d0d0"}` }}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              {agentRunning && <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#9ec89e", animation: "pulse-ring .9s ease-out infinite" }} />}
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: agentRunning ? "#5f9a5f" : "#c97070", display: "block", position: "relative" }} />
            </span>
            <span style={{ fontSize: 12, color: agentRunning ? "#5f9a5f" : "#c97070", fontWeight: 500 }}>
              Agent {agentRunning ? "active" : "waiting"}
            </span>
          </div>
          {(agentState?.lastCycleMs ?? 0) > 0 && (
            <span style={{ fontSize: 11, color: "#c4b8b8" }}>{((agentState?.lastCycleMs ?? 0) / 1000).toFixed(1)}s/cycle</span>
          )}
          {agentState?.gasGwei && (
            <span style={{ fontSize: 11, color: "#c4b8b8", padding: "4px 10px", background: "#fdf9f7", border: "1px solid #ede8e8", borderRadius: 99 }}>
              ⛽ {agentState.gasGwei} gwei
            </span>
          )}
        </div>
      </header>

      <main style={{ padding: "28px 32px", maxWidth: 1200, margin: "0 auto" }}>

        {/* ── Markets Tab ── */}
        {activeTab === "markets" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 24, alignItems: "start" }}>
            <div>
              {/* KPI strip */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 24 }}>
                {[
                  { label: "Markets",     value: String(markets.length),    sub: liveMarkets.length > 0 ? "on-chain" : "demo", accent: "#b9a8e8", bg: "#f3f0fb", border: "#ddd5f5" },
                  { label: "Volume",      value: liveMarkets.length > 0 ? `$${(liveMarkets.reduce((s, m) => s + Number(m.volumeUsdt), 0) / 1000).toFixed(0)}K` : "$13.7M", sub: "USD₮ deposited", accent: "#9ec89e", bg: "#f0f5f0", border: "#cde0cd" },
                  { label: "Resolutions", value: String(resolutions.filter(r => r.proposed).length), sub: `${resolutions.filter(r => r.finalized).length} finalized`, accent: "#e8a8a8", bg: "#fdf0f0", border: "#f5d0d0" },
                  { label: "Win rate",    value: winRate !== null ? `${winRate}%` : "—",   sub: "resolved markets",  accent: "#c49a00", bg: "#fffbf0", border: "#f0e0a0" },
                  { label: "P&L",         value: portfolioPnl ? `${portfolioPnl.positive ? "+" : ""}${portfolioPnl.pct}%` : "—", sub: "portfolio change", accent: portfolioPnl?.positive ? "#9ec89e" : "#e8a8a8", bg: portfolioPnl?.positive ? "#f0f5f0" : "#fdf0f0", border: portfolioPnl?.positive ? "#cde0cd" : "#f5d0d0" },
                ].map((k, i) => (
                  <div key={i} style={{ background: k.bg, border: `1px solid ${k.border}`, borderRadius: 14, padding: "14px 16px", animation: `fadeUp .3s ease ${i * .05}s both` }}>
                    <p style={{ fontSize: 10, color: k.accent, fontWeight: 600, marginBottom: 6, letterSpacing: ".04em" }}>{k.label.toUpperCase()}</p>
                    <p style={{ fontSize: 22, fontWeight: 400, fontFamily: "'DM Serif Display', Georgia, serif", color: "#2a2020", letterSpacing: "-.5px", lineHeight: 1 }}>{k.value}</p>
                    <p style={{ fontSize: 10, color: "#c4b8b8", marginTop: 4 }}>{k.sub}</p>
                  </div>
                ))}
              </div>

              {liveMarkets.length === 0 && (
                <div style={{ background: "#fffbf0", border: "1px solid #f0e0a0", borderRadius: 10, padding: "9px 14px", marginBottom: 14, fontSize: 12, color: "#c49a00" }}>
                  Showing demo markets — agent is not yet returning live data
                </div>
              )}


              {/* Search + sort + filter row */}
              <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
                  <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#c4b8b8", fontSize: 13 }}>🔍</span>
                  <input
                    type="text"
                    placeholder="Search markets…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ width: "100%", paddingLeft: 34, paddingRight: 12, paddingTop: 9, paddingBottom: 9, border: "1px solid #ede8e8", borderRadius: 10, fontSize: 13, color: "#2a2020", background: "#fff", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ display: "flex", gap: 4, background: "#fdf9f7", border: "1px solid #ede8e8", borderRadius: 10, padding: 4 }}>
                  {(["trending", "volume", "closes", "probability"] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setSortBy(s)}
                      style={{ padding: "5px 10px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 500, background: sortBy === s ? "#fff" : "transparent", color: sortBy === s ? "#2a2020" : "#b8aeae", boxShadow: sortBy === s ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all .15s ease" }}
                    >
                      {s === "closes" ? "Closing soon" : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {availableCategories.map(c => (
                    <button key={c} className={`filter-pill ${filter === c ? "active" : ""}`} onClick={() => setFilter(c)}>{c}</button>
                  ))}
                </div>
              </div>

              {/* Market grid */}
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 0", color: "#c4b8b8" }}>
                  <p style={{ fontSize: 32, marginBottom: 12 }}>🔍</p>
                  <p style={{ fontSize: 14, fontWeight: 500, color: "#9a8e8e" }}>No markets match &ldquo;{search}&rdquo;</p>
                  <p style={{ fontSize: 12, marginTop: 6 }}>Try a different search or clear the filter</p>
                </div>
              ) : (
                <div className="card-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {filtered.map(m => (
                    <MarketCard key={String(m.id)} market={m} onClick={() => setSelected(selected?.id === m.id ? null : m)} />
                  ))}
                </div>
              )}

              {liveMarkets.length === 0 && filtered.length > 0 && (
                <p style={{ fontSize: 12, color: "#c4b8b8", marginTop: 12, textAlign: "center" }}>Showing demo markets — start the agent to load live on-chain markets</p>
              )}
            </div>

            {/* Right panel */}
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
                      { label: "On-chain", val: selected.address ? "✓ Live" : "Mock" },
                    ].map(r => (
                      <div key={r.label} style={{ background: "#fdf9f7", borderRadius: 10, padding: "10px 12px" }}>
                        <p style={{ fontSize: 10, color: "#c4b8b8", marginBottom: 3 }}>{r.label}</p>
                        <p style={{ fontSize: 13, fontWeight: 500, color: "#2a2020" }}>{r.val}</p>
                      </div>
                    ))}
                  </div>
                  {selected.address && (
                    <a href={`https://sepolia.etherscan.io/address/${selected.address}`} target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center", fontSize: 11, color: "#b9a8e8", textDecoration: "none", marginBottom: 12 }}>
                      View on Etherscan ↗
                    </a>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button className="place-btn" style={{ background: "#f0f5f0", color: "#5f9a5f" }}>Buy YES — {selected.yesProb}¢</button>
                    <button className="place-btn" style={{ background: "#fdf0f0", color: "#c97070" }}>Buy NO — {100 - selected.yesProb}¢</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                  <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, color: "#2a2020", marginBottom: 16 }}>Top movers</p>
                  {[...markets].sort((a, b) => Math.abs((b.trend[b.trend.length-1] ?? 0) - (b.trend[0] ?? 0)) - Math.abs((a.trend[a.trend.length-1] ?? 0) - (a.trend[0] ?? 0))).slice(0, 4).map(m => {
                    const delta = (m.trend[m.trend.length - 1] ?? 0) - (m.trend[0] ?? 0);
                    const up = delta >= 0;
                    return (
                      <div key={String(m.id)} onClick={() => setSelected(m)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #f5f0f0", cursor: "pointer" }}>
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
                {subscriptionState && (
                  <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, color: "#2a2020" }}>Subscriptions</p>
                      <span style={{ fontSize: 11, background: "#f0f5f0", border: "1px solid #cde0cd", color: "#5f9a5f", borderRadius: 99, padding: "3px 10px", fontWeight: 500 }}>
                        {subscriptionState.activeSubscribers} active
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: "#c4b8b8", marginBottom: 14 }}>${subscriptionState.totalRevenue} USD₮ total revenue</p>
                    {subscriptionState.plans.filter(p => p.name !== "FREE").map(plan => (
                      <div key={plan.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid #f5f0f0" }}>
                        <div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#2a2020" }}>{plan.name}</span>
                          <span style={{ fontSize: 11, color: "#c4b8b8", marginLeft: 6 }}>{plan.periodDays}d</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 500, color: "#7b62c9" }}>{plan.priceUsdt} USD₮</span>
                      </div>
                    ))}
                  </div>
                )}
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
                  { label: "Portfolio value", val: portfolioVal, sub: "total mark-to-market", color: "#7b62c9", bg: "#f3f0fb", border: "#ddd5f5" },
                  { label: "USD₮ balance",    val: usdtBal,      sub: "agent wallet",        color: "#5f9a5f", bg: "#f0f5f0", border: "#cde0cd" },
                  { label: "XAU₮ balance",    val: xautBal,      sub: "agent wallet",        color: "#b9a8e8", bg: "#f3f0fb", border: "#ddd5f5" },
                ].map((k, i) => (
                  <div key={i} style={{ background: k.bg, border: `1px solid ${k.border}`, borderRadius: 14, padding: "16px 18px" }}>
                    <p style={{ fontSize: 11, color: k.color, fontWeight: 500, marginBottom: 6 }}>{k.label.toUpperCase()}</p>
                    <p style={{ fontSize: 22, fontFamily: "'DM Serif Display', serif", color: "#2a2020", letterSpacing: "-.5px", lineHeight: 1 }}>{k.val}</p>
                    <p style={{ fontSize: 11, color: "#c4b8b8", marginTop: 5 }}>{k.sub}</p>
                  </div>
                ))}
              </div>

              {/* Portfolio chart */}
              <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px", marginBottom: 20 }}>
                <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, marginBottom: 16 }}>Portfolio value over time</p>
                <PortfolioChart snapshots={chartSnapshots} />
              </div>

              {/* Snapshots list */}
              {latestSnap && (
                <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                  <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, marginBottom: 4 }}>Latest snapshot</p>
                  <p style={{ fontSize: 11, color: "#c4b8b8", marginBottom: 16 }}>{new Date(latestSnap.snapshotAt).toLocaleString()}</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {[
                      { label: "ETH balance", val: `${latestSnap.ethBalance} ETH` },
                      { label: "USD₮",        val: `$${latestSnap.usdtBalance}` },
                      { label: "XAU₮",        val: latestSnap.xautBalance },
                      { label: "Total (USDT)", val: `$${latestSnap.totalUsdt}` },
                    ].map(r => (
                      <div key={r.label} style={{ background: "#fdf9f7", borderRadius: 10, padding: "10px 12px" }}>
                        <p style={{ fontSize: 10, color: "#c4b8b8", marginBottom: 3 }}>{r.label}</p>
                        <p style={{ fontSize: 14, fontWeight: 500, color: "#2a2020" }}>{r.val}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Vault panel */}
              <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, marginBottom: 16 }}>AgentVault</p>
                {vaultState ? (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <p style={{ fontSize: 11, color: "#c4b8b8", marginBottom: 4 }}>VAULT BALANCE</p>
                      <p style={{ fontSize: 22, fontFamily: "'DM Serif Display', serif", color: "#2a2020" }}>${Number(vaultState.vaultUsdt).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                      <p style={{ fontSize: 11, color: "#b8aeae", marginTop: 2 }}>USD₮ on-chain</p>
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: "#5a4a4a" }}>Daily limit used</span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "#2a2020" }}>${vaultState.dailyUsed} / ${vaultState.dailyLimit}</span>
                      </div>
                      <div style={{ height: 5, background: "#f5f0f0", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          width: `${Number(vaultState.dailyLimit) > 0 ? Math.min(100, (Number(vaultState.dailyUsed) / Number(vaultState.dailyLimit)) * 100) : 0}%`,
                          background: "#b9a8e8", borderRadius: 99, transition: "width .5s ease"
                        }} />
                      </div>
                      <p style={{ fontSize: 11, color: "#b8aeae", marginTop: 5 }}>${vaultState.remainingDaily} remaining today</p>
                    </div>
                    <div style={{ background: "#f3f0fb", borderRadius: 10, padding: "10px 12px" }}>
                      <p style={{ fontSize: 10, color: "#7b62c9", marginBottom: 3 }}>AGENT WALLET</p>
                      <p style={{ fontSize: 14, fontWeight: 500, color: "#2a2020" }}>${vaultState.agentUsdt} USD₮</p>
                      <p style={{ fontSize: 10, color: "#b9a8e8", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vaultState.agentAddress}</p>
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize: 13, color: "#c4b8b8", textAlign: "center", padding: "20px 0" }}>Loading vault data…</p>
                )}
              </div>

              {/* Cycle stats */}
              {agentState && (
                <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                  <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, marginBottom: 16 }}>Agent stats</p>
                  {[
                    { label: "Iteration",   val: `#${agentState.iteration}` },
                    { label: "Cycle time",  val: `${(agentState.lastCycleMs / 1000).toFixed(1)}s` },
                    { label: "Sentiment",   val: agentState.marketSentiment },
                    { label: "Network",     val: agentState.network },
                    { label: "Snapshots",   val: String(snapshots.length) },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid #f5f0f0", alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: "#9a8e8e" }}>{r.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "#2a2020" }}>{r.val}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Agent Tab ── */}
        {activeTab === "agent" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Config */}
              <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16 }}>Agent configuration</p>
                  {agentState && <SentimentBadge sentiment={agentState.marketSentiment} />}
                </div>
                {[
                  { label: "Strategy",           val: "Expected-value prediction markets" },
                  { label: "Max position",        val: "$500 per market" },
                  { label: "LLM model",           val: "Claude Sonnet 4.6" },
                  { label: "Iteration",           val: agentState ? `#${agentState.iteration}` : "—" },
                  { label: "Last cycle",          val: agentState ? `${(agentState.lastCycleMs / 1000).toFixed(1)}s` : "—" },
                  { label: "Status",              val: agentState?.status ?? "WAITING" },
                ].map(r => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f5f0f0", alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: "#9a8e8e" }}>{r.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "#2a2020" }}>{r.val}</span>
                  </div>
                ))}
              </div>

              {/* Live reasoning */}
              <div style={{ background: "#f3f0fb", border: "1px solid #ddd5f5", borderRadius: 16, padding: "20px 22px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <p style={{ fontSize: 11, color: "#7b62c9", fontWeight: 500 }}>CURRENT REASONING</p>
                  {agentState && <SentimentBadge sentiment={agentState.marketSentiment} />}
                </div>
                <p style={{ fontSize: 13, color: "#4a3a6a", lineHeight: 1.65, fontStyle: "italic" }}>
                  &ldquo;{agentState?.reasoning || agentState?.summary || "Waiting for agent to complete a cycle…"}&rdquo;
                </p>
                {agentState?.summary && agentState.summary !== agentState.reasoning && (
                  <p style={{ fontSize: 12, color: "#7b62c9", lineHeight: 1.5, marginTop: 10, fontStyle: "normal" }}>
                    {agentState.summary}
                  </p>
                )}
                <p style={{ fontSize: 11, color: "#b9a8e8", marginTop: 10 }}>
                  {agentState ? `Updated ${new Date(agentState.updatedAt).toLocaleTimeString()}` : "No data yet"}
                </p>
              </div>

              {/* Resolution panel */}
              <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16 }}>AI Oracle resolutions</p>
                  <span style={{ fontSize: 11, background: "#f3f0fb", border: "1px solid #ddd5f5", color: "#7b62c9", borderRadius: 99, padding: "3px 10px", fontWeight: 500 }}>
                    {resolutions.filter(r => r.proposed).length} proposed
                  </span>
                </div>
                <p style={{ fontSize: 11, color: "#c4b8b8", marginBottom: 16 }}>24h dispute window before finalization</p>
                {resolutions.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#c4b8b8", textAlign: "center", padding: "20px 0" }}>No markets resolved yet</p>
                ) : (
                  resolutions.map((r, i) => <ResolutionRow key={i} r={r} />)
                )}
              </div>

              {/* ConditionalPayment escrows */}
              <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16 }}>Performance escrows</p>
                  <span style={{ fontSize: 11, background: "#f0f5f0", border: "1px solid #cde0cd", color: "#5f9a5f", borderRadius: 99, padding: "3px 10px", fontWeight: 500 }}>
                    {conditionalPayments.filter(p => p.status === "PENDING").length} active
                  </span>
                </div>
                <p style={{ fontSize: 11, color: "#c4b8b8", marginBottom: 16 }}>USD₮ locked — released only if agent prediction is correct</p>
                {conditionalPayments.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#c4b8b8", textAlign: "center", padding: "20px 0" }}>No escrows yet</p>
                ) : (
                  conditionalPayments.map((p, i) => (
                    <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 0", borderBottom: i < conditionalPayments.length - 1 ? "1px solid #f5f0f0" : "none" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: "#2a2020", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 10 }}>
                          {p.question ?? `Market ${p.marketId.slice(0, 10)}…`}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#5f9a5f", flexShrink: 0 }}>${p.amountUsdt} USD₮</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: "#7b62c9", background: "#f3f0fb", border: "1px solid #ddd5f5", borderRadius: 99, padding: "2px 8px" }}>
                          if {p.triggerOutcome}
                        </span>
                        <span style={{ fontSize: 10, color: p.status === "CLAIMED" ? "#5f9a5f" : p.status === "REFUNDED" ? "#c97070" : "#9a8e8e", fontWeight: 500 }}>
                          {p.status}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Activity log */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16 }}>Trade executions</p>
                  <span style={{ fontSize: 11, background: agentRunning ? "#f0f5f0" : "#fdf9f7", border: `1px solid ${agentRunning ? "#cde0cd" : "#ede8e8"}`, color: agentRunning ? "#5f9a5f" : "#9a8e8e", borderRadius: 99, padding: "3px 10px", fontWeight: 500 }}>
                    {agentRunning ? "Live" : "Idle"}
                  </span>
                </div>
                <TradeTable trades={trades} />
              </div>

              {/* Last executions from current cycle */}metadata
              {agentState && agentState.executions.length > 0 && (
                <div style={{ background: "#fff", border: "1px solid #ede8e8", borderRadius: 16, padding: "22px" }}>
                  <p style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, marginBottom: 16 }}>Last cycle actions</p>
                  {agentState.executions.map((e, i) => {
                    const actionColors: Record<string, string> = {
                      ENTER_MARKET: "#5f9a5f", EXIT_MARKET: "#7b62c9",
                      REBALANCE: "#c49a00", BRIDGE_USDT0: "#7b62c9", HOLD: "#c4b8b8"
                    };
                    const color = actionColors[e.actionType] ?? "#b8aeae";
                    return (
                      <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < agentState.executions.length - 1 ? "1px solid #f5f0f0" : "none" }}>
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color, fontWeight: 600 }}>
                            {e.actionType === "ENTER_MARKET" ? "▲" : e.actionType === "EXIT_MARKET" ? "▼" : e.actionType === "BRIDGE_USDT0" ? "⇢" : e.actionType === "REBALANCE" ? "⇄" : "◆"}
                          </span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 500, color: "#2a2020" }}>{e.actionType}</p>
                          <p style={{ fontSize: 11, color: "#c4b8b8", marginTop: 2 }}>
                            {e.skipped ? "skipped" : e.success ? (e.txHash ? `${e.txHash.slice(0, 10)}…` : "ok") : e.error ?? "failed"}
                          </p>
                        </div>
                        <span style={{ fontSize: 11, color: e.success ? "#9ec89e" : "#e8a8a8", flexShrink: 0, fontWeight: 500 }}>
                          {e.success ? "✓" : "✗"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
