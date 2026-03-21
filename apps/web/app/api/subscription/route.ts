import { NextResponse } from "next/server";

const SUBSCRIPTION_ABI = [
  "function activeSubscribers() external view returns (uint256)",
  "function totalRevenue() external view returns (uint256)",
  "function plans(uint8 plan) external view returns (uint256 pricePerPeriod, uint256 period, uint256 gracePeriod, bool active)",
  "function isActive(address account) external view returns (bool)",
  "function subscriptions(address) external view returns (address subscriber, uint8 plan, uint256 startedAt, uint256 paidUntil, uint256 totalPaid, bool cancelled)",
  "event Subscribed(address indexed subscriber, uint8 plan, uint256 paidUntil)",
];

const PLAN_NAMES = ["FREE", "BASIC", "PRO", "INSTITUTIONAL"];
const PLAN_PRICES = ["$0", "$29", "$99", "$499"];

export async function GET() {
  const rpcUrl  = process.env["RPC_URL"];
  const smAddr  = process.env["SUBSCRIPTION_MANAGER_ADDRESS"];

  if (!rpcUrl || !smAddr) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  try {
    const { ethers } = await import("ethers");
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const sm         = new ethers.Contract(smAddr, SUBSCRIPTION_ABI, provider) as any;

    const [activeSubscribers, totalRevenue, ...planConfigs] = await Promise.all([
      sm.activeSubscribers() as Promise<bigint>,
      sm.totalRevenue()      as Promise<bigint>,
      sm.plans(0) as Promise<{ pricePerPeriod: bigint; period: bigint; gracePeriod: bigint; active: boolean }>,
      sm.plans(1) as Promise<{ pricePerPeriod: bigint; period: bigint; gracePeriod: bigint; active: boolean }>,
      sm.plans(2) as Promise<{ pricePerPeriod: bigint; period: bigint; gracePeriod: bigint; active: boolean }>,
      sm.plans(3) as Promise<{ pricePerPeriod: bigint; period: bigint; gracePeriod: bigint; active: boolean }>,
    ]);

    const plans = planConfigs.map((cfg, i) => ({
      id:             i,
      name:           PLAN_NAMES[i] ?? `PLAN_${i}`,
      priceUsdt:      PLAN_PRICES[i] ?? `$${(Number(cfg.pricePerPeriod) / 1e6).toFixed(0)}`,
      periodDays:     Math.round(Number(cfg.period) / 86400),
      gracePeriodDays:Math.round(Number(cfg.gracePeriod) / 86400),
      active:         cfg.active,
    }));

    let recentSubscribers: { address: string; plan: string; paidUntil: string; active: boolean }[] = [];
    try {
      const subscribedFilter = sm.filters.Subscribed();
      const events = await sm.queryFilter(subscribedFilter, -10) as Array<{
        args: { subscriber: string; plan: number; paidUntil: bigint };
      }>;
      recentSubscribers = await Promise.all(
        events.slice(-5).reverse().map(async (e) => {
          const active = await sm.isActive(e.args.subscriber) as boolean;
          return {
            address:  e.args.subscriber,
            plan:     PLAN_NAMES[e.args.plan] ?? "UNKNOWN",
            paidUntil:new Date(Number(e.args.paidUntil) * 1000).toISOString(),
            active,
          };
        })
      );
    } catch { /* no recent subscriber events */ }

    const cache = { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' };
    return NextResponse.json({
      contractAddress:   smAddr,
      activeSubscribers: Number(activeSubscribers),
      totalRevenue:      (Number(totalRevenue) / 1e6).toFixed(2),
      plans,
      recentSubscribers,
    }, { headers: cache });
  } catch (err) {
    console.error("[/api/subscription]", err);
    return NextResponse.json({ error: "Chain read failed" }, { status: 500 });
  }
}
