# @repo/wdk — Wallet Development Kit Wrapper

Thin, typed wrapper around `@tetherto/wdk-wallet-evm` that exposes a clean interface for the rest of the monorepo.

## Modules

| File | Purpose |
|---|---|
| `wallet.ts` | `AgentWallet` class and `createAgentWallet()` factory |
| `transactions.ts` | ERC-20 transfer execution (`transferUSDT`, `transferXAUT`, `quoteTransfer`) |
| `accounts.ts` | Balance helpers, `getPortfolioSnapshot()`, `hasEnoughGas()` |

## Key API

```ts
import { createAgentWallet } from "@repo/wdk";

const wallet = await createAgentWallet();
const account = await wallet.getAccount(0);

// Get balances
const eth   = await account.getBalance();                    // wei
const usdt  = await account.getTokenBalance(USDT_ADDRESS);  // micro-USDT

// Transfer
const result = await account.transfer({
  token: USDT_CONTRACT_ADDRESS,
  recipient: "0xRecipient…",
  amount: 1_000_000n, // 1 USDT
});

// Dispose (wipes private keys from memory)
wallet.dispose();
```

## Environment Variables

| Variable | Description |
|---|---|
| `SEED_PHRASE` | BIP-39 mnemonic (12 or 24 words) |
| `ETH_RPC_URL` | Ethereum JSON-RPC endpoint |
| `TRANSFER_MAX_FEE` | Maximum gas fee per transfer (wei, default `5000000000000000`) |
| `USDT_CONTRACT_ADDRESS` | ERC-20 address for USD₮ |
| `XAUT_CONTRACT_ADDRESS` | ERC-20 address for XAU₮ |

## Token Decimals

- **USDT**: 6 decimals → 1 USDT = `1_000_000`
- **XAUT**: 6 decimals → 1 XAUT = `1_000_000`
