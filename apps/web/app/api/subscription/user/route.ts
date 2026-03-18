import { NextRequest, NextResponse } from "next/server";

const SUBSCRIPTION_ABI = [
  "function subscriptions(address) external view returns (address subscriber, uint8 plan, uint256 startedAt, uint256 paidUntil, uint256 totalPaid, bool cancelled)",
  "function isActive(address account) external view returns (bool)",
];

const PLAN_NAMES = ["FREE", "BASIC", "PRO", "INSTITUTIONAL"];

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) return NextResponse.json({ error: "Missing address" }, { status: 400 });

  const rpcUrl = process.env["RPC_URL"];
  const smAddr = process.env["SUBSCRIPTION_MANAGER_ADDRESS"];
  if (!rpcUrl || !smAddr) return NextResponse.json({ plan: null });

  try {
    const { ethers } = await import("ethers");
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const sm = new ethers.Contract(smAddr, SUBSCRIPTION_ABI, provider) as any;

    const [sub, active] = await Promise.all([
      sm.subscriptions(address) as Promise<{ plan: number; paidUntil: bigint; cancelled: boolean }>,
      sm.isActive(address) as Promise<boolean>,
    ]);

    const plan = active ? (PLAN_NAMES[Number(sub.plan)] ?? "UNKNOWN") : null;
    const paidUntil = active ? new Date(Number(sub.paidUntil) * 1000).toISOString() : null;

    return NextResponse.json({ plan, paidUntil, active });
  } catch {
    return NextResponse.json({ plan: null });
  }
}
