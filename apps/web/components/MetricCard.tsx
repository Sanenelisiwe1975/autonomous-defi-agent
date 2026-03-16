"use client";

interface Props {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}

export function MetricCard({ label, value, sub, accent = "#00e676" }: Props) {
  return (
    <div
      className="metric-card"
      style={{ "--accent": accent } as React.CSSProperties}
    >
      <style>{`
        .metric-card {
          position: relative;
          background: #0c0c0c;
          border: 1px solid #1a1a1a;
          border-radius: 4px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          overflow: hidden;
          transition: border-color 0.2s ease, transform 0.15s ease;
          cursor: default;
        }

        .metric-card:hover {
          border-color: #2a2a2a;
          transform: translateY(-1px);
        }

        /* Top accent bar */
        .metric-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: var(--accent);
          opacity: 0.5;
          transition: opacity 0.2s;
        }

        .metric-card:hover::before {
          opacity: 0.9;
        }

        /* Subtle corner glow */
        .metric-card::after {
          content: '';
          position: absolute;
          top: -20px; right: -20px;
          width: 60px; height: 60px;
          border-radius: 50%;
          background: radial-gradient(circle, var(--accent) 0%, transparent 70%);
          opacity: 0.04;
          transition: opacity 0.2s;
          pointer-events: none;
        }

        .metric-card:hover::after {
          opacity: 0.09;
        }

        .metric-card__label {
          font-family: 'IBM Plex Mono', 'Courier New', monospace;
          font-size: 9px;
          letter-spacing: 0.2em;
          color: #3a3a3a;
          text-transform: uppercase;
          line-height: 1;
        }

        .metric-card__value {
          font-family: 'IBM Plex Mono', 'Courier New', monospace;
          font-size: 22px;
          font-weight: 700;
          color: var(--accent);
          letter-spacing: -0.03em;
          line-height: 1;
          /* Prevent layout shift if value changes length */
          font-variant-numeric: tabular-nums;
        }

        .metric-card__sub {
          font-family: 'IBM Plex Mono', 'Courier New', monospace;
          font-size: 10px;
          color: #2a2a2a;
          letter-spacing: 0.04em;
          line-height: 1.3;
        }
      `}</style>

      <span className="metric-card__label">{label}</span>
      <span className="metric-card__value">{value}</span>
      {sub && <span className="metric-card__sub">{sub}</span>}
    </div>
  );
}
