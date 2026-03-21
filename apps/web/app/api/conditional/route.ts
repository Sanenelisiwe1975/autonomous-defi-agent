import { NextResponse } from "next/server";

const CONDITIONAL_ABI = [
  "function getPayment(bytes32 id) external view returns (tuple(address creator, address beneficiary, address market, bytes32 marketId, address collateral, uint256 amount, uint8 triggerOutcome, uint8 payoffType, bytes customPayoff, uint256 expiresAt, bool cancelled))",
  "event PaymentCreated(bytes32 indexed id, address indexed creator, address indexed beneficiary, bytes32 marketId, uint256 amount, uint8 triggerOutcome)",
  "event PaymentClaimed(bytes32 indexed id, address beneficiary, uint256 amount)",
  "event PaymentRefunded(bytes32 indexed id, address creator, uint256 amount)",
];

const MARKET_ABI = ["function question() external view returns (string)"];

const OUTCOME_LABEL = ["UNRESOLVED", "YES", "NO"];

export async function GET() {
  const rpcUrl      = process.env["RPC_URL"];
  const cpAddress   = process.env["CONDITIONAL_PAYMENT_ADDRESS"];

  if (!rpcUrl || !cpAddress) {
    return NextResponse.json({ payments: [] });
  }

  try {
    const { ethers } = await import("ethers");
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const cp         = new ethers.Contract(cpAddress, CONDITIONAL_ABI, provider) as any;

    const createdFilter  = cp.filters.PaymentCreated();
    const claimedFilter  = cp.filters.PaymentClaimed();
    const refundedFilter = cp.filters.PaymentRefunded();

    const [createdEvents, claimedEvents, refundedEvents] = await Promise.all([
      cp.queryFilter(createdFilter,  0) as Promise<Array<{ args: { id: string; creator: string; beneficiary: string; marketId: string; amount: bigint; triggerOutcome: number } }>>,
      cp.queryFilter(claimedFilter,  0) as Promise<Array<{ args: { id: string } }>>,
      cp.queryFilter(refundedFilter, 0) as Promise<Array<{ args: { id: string } }>>,
    ]);

    const claimedIds  = new Set(claimedEvents.map(e  => e.args.id));
    const refundedIds = new Set(refundedEvents.map(e => e.args.id));

    const payments = await Promise.all(
      createdEvents.map(async (e) => {
        const { id, creator, beneficiary, marketId, amount, triggerOutcome } = e.args;

        let question: string | null = null;
        try {
          const marketAddr = ethers.getAddress("0x" + marketId.slice(-40));
          const market = new ethers.Contract(marketAddr, MARKET_ABI, provider) as any;
          question = await market.question() as string;
        } catch { /* market may not implement question */ }

        const status = claimedIds.has(id) ? "CLAIMED" : refundedIds.has(id) ? "REFUNDED" : "PENDING";

        return {
          id,
          creator,
          beneficiary,
          marketId,
          question,
          amountUsdt:     (Number(amount) / 1e6).toFixed(2),
          triggerOutcome: OUTCOME_LABEL[Number(triggerOutcome)] ?? "UNKNOWN",
          status,
        };
      })
    );

    return NextResponse.json({ payments });
  } catch (err) {
    console.error("[/api/conditional]", err);
    return NextResponse.json({ payments: [] });
  }
}
