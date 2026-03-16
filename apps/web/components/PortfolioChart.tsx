"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Snapshot {
  snapshotAt: string;
  totalUsdt: string;
}

interface Props {
  snapshots: Snapshot[];
}

export function PortfolioChart({ snapshots }: Props) {
  const data = snapshots.map((s) => ({
    time: new Date(s.snapshotAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    value: parseFloat(s.totalUsdt),
  }));

  if (data.length < 2) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 200,
          color: "var(--text-muted)",
          fontSize: 13,
          border: "1px dashed var(--border)",
          borderRadius: 8,
        }}
      >
        Waiting for data — portfolio chart appears after 2+ cycles
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#26a17b" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#26a17b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          width={60}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text-primary)",
            fontSize: 12,
          }}
          formatter={(value: number) => [`$${value.toFixed(2)} USD₮`, "Portfolio"]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#26a17b"
          strokeWidth={2}
          fill="url(#portfolioGradient)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
