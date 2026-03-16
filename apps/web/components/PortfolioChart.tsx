"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface Snapshot {
  snapshotAt: string;
  totalUsdt: string;
}

interface Props {
  snapshots: Snapshot[];
}


function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;

  return (
    <div style={{
      background: "#0e0e0e",
      border: "1px solid #2a2a2a",
      borderRadius: 3,
      padding: "8px 12px",
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
    }}>
      <div style={{ fontSize: 9, letterSpacing: "0.18em", color: "#3a3a3a", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#c8b560", letterSpacing: "-0.02em" }}>
        ${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div style={{ fontSize: 9, color: "#2e2e2e", letterSpacing: "0.1em", marginTop: 2 }}>
        USD₮
      </div>
    </div>
  );
}


function EmptyState() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: 220,
      gap: 10,
      border: "1px dashed #1e1e1e",
      borderRadius: 4,
    }}>
      {/* Mini decorative chart lines */}
      <svg width="48" height="28" viewBox="0 0 48 28" fill="none">
        <polyline points="0,24 10,18 20,22 30,10 40,14 48,6" stroke="#2a2a2a" strokeWidth="1.5" strokeLinejoin="round" />
        <polyline points="0,24 10,18 20,22 30,10 40,14 48,6" stroke="#c8b56020" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span style={{
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
        fontSize: 10,
        letterSpacing: "0.14em",
        color: "#2a2a2a",
      }}>
        AWAITING DATA — 2+ CYCLES REQUIRED
      </span>
    </div>
  );
}


export function PortfolioChart({ snapshots }: Props) {
  const data = snapshots.map((s) => ({
    time: new Date(s.snapshotAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    value: parseFloat(s.totalUsdt),
  }));

  if (data.length < 2) return <EmptyState />;

  const values      = data.map((d) => d.value);
  const minVal      = Math.min(...values);
  const maxVal      = Math.max(...values);
  const isUp        = data[data.length - 1].value >= data[0].value;
  const strokeColor = isUp ? "#c8b560" : "#ff1744";
  const gradId      = "pgGrad";

  return (
    <div style={{ position: "relative" }}>
      <style>{`
        .recharts-cartesian-axis-tick text {
          font-family: 'IBM Plex Mono', 'Courier New', monospace !important;
        }
        .recharts-reference-line line {
          stroke-dasharray: 3 4;
        }
      `}</style>

      {/* Delta badge */}
      {data.length >= 2 && (() => {
        const first = data[0].value;
        const last  = data[data.length - 1].value;
        const delta = ((last - first) / first) * 100;
        const sign  = delta >= 0 ? "+" : "";
        return (
          <div style={{
            position: "absolute",
            top: 0, right: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
            zIndex: 2,
          }}>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              color: delta >= 0 ? "#00e676" : "#ff1744",
              letterSpacing: "0.06em",
            }}>
              {sign}{delta.toFixed(2)}%
            </span>
            <span style={{ fontSize: 9, color: "#2e2e2e", letterSpacing: "0.1em" }}>SESSION</span>
          </div>
        );
      })()}

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 16, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={strokeColor} stopOpacity={0.18} />
              <stop offset="100%" stopColor={strokeColor} stopOpacity={0}    />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="time"
            tick={{ fill: "#2e2e2e", fontSize: 9, letterSpacing: "0.1em" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "#2e2e2e", fontSize: 9, letterSpacing: "0.06em" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            width={52}
            domain={["auto", "auto"]}
          />

          {/* Min / max reference lines */}
          <ReferenceLine
            y={maxVal}
            stroke="#2a2a2a"
            label={{ value: `MAX $${maxVal.toFixed(2)}`, position: "insideTopRight", fill: "#3a3a3a", fontSize: 8, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.1em" }}
          />
          <ReferenceLine
            y={minVal}
            stroke="#2a2a2a"
            label={{ value: `MIN $${minVal.toFixed(2)}`, position: "insideBottomRight", fill: "#3a3a3a", fontSize: 8, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.1em" }}
          />

          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: "#2a2a2a", strokeWidth: 1, strokeDasharray: "3 4" }}
          />

          <Area
            type="monotone"
            dataKey="value"
            stroke={strokeColor}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            dot={false}
            activeDot={{ r: 3, fill: strokeColor, strokeWidth: 0 }}
            animationDuration={800}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
