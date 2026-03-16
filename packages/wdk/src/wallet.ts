/**
 * @file wallet.ts
 * @description WDK wallet creation and lifecycle management.
 *
 * Wraps @tetherto/wdk-wallet-evm to provide a clean, typed interface
 * for creating and managing non-custodial EVM wallets from BIP-39 seed
 * phrases. All signing stays client-side — keys never leave this process.
 *
 * @license Apache-2.0
 */

import WalletManagerEvm, {
  type WalletAccountEvm,
} from "@tetherto/wdk-wallet-evm";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Configuration for the WDK wallet manager. */
export interface WalletConfig {
  /** JSON-RPC endpoint URL (e.g. Alchemy / Infura / public node). */
  rpcUrl: string;
  /**
   * Maximum fee the agent will pay per transaction, in wei.
   * Acts as a hard safety cap — transactions exceeding this are rejected.
   * Default: 0.001 ETH (1_000_000_000_000_000n wei).
   */
  transferMaxFee?: bigint;
}

/** Snapshot of an account's on-chain state. */
export interface AccountInfo {
  address: string;
  /** Native ETH balance in wei. */
  ethBalance: bigint;
  /** USD₮ balance in micro-USDT (6 decimals). */
  usdtBalance: bigint;
  /** XAU₮ balance in smallest unit (6 decimals). */
  xautBalance: bigint;
  derivationIndex: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default max fee: 0.001 ETH in wei. */
const DEFAULT_MAX_FEE = 1_000_000_000_000_000n;

// ─── WDK Wallet Manager ───────────────────────────────────────────────────────

/**
 * AgentWallet wraps WalletManagerEvm and provides the agent with
 * a single high-level interface for account access and balance queries.
 *
 * @example
 * ```ts
 * const wallet = new AgentWallet(process.env.AGENT_SEED_PHRASE!, {
 *   rpcUrl: process.env.RPC_URL!,
 * });
 * const account = await wallet.getAccount(0);
 * const address = await account.getAddress();
 * ```
 */
export class AgentWallet {
  private readonly manager: WalletManagerEvm;
  private readonly config: Required<WalletConfig>;

  constructor(seedPhrase: string, config: WalletConfig) {
    if (!seedPhrase || seedPhrase.trim().split(" ").length < 12) {
      throw new Error(
        "Invalid seed phrase: must be a BIP-39 mnemonic (12–24 words)."
      );
    }
    if (!config.rpcUrl) {
      throw new Error("WalletConfig.rpcUrl is required.");
    }

    this.config = {
      rpcUrl: config.rpcUrl,
      transferMaxFee: config.transferMaxFee ?? DEFAULT_MAX_FEE,
    };

    this.manager = new WalletManagerEvm(seedPhrase, {
      provider: this.config.rpcUrl,
      transferMaxFee: this.config.transferMaxFee,
    });
  }

  /**
   * Returns the WalletAccountEvm at the given BIP-44 derivation index.
   * Index 0 is the primary agent account used for all operations.
   *
   * @param index - BIP-44 account index (default: 0)
   */
  async getAccount(index = 0): Promise<WalletAccountEvm> {
    return this.manager.getAccount(index);
  }

  /**
   * Returns the primary agent account (index 0).
   */
  async getPrimaryAccount(): Promise<WalletAccountEvm> {
    return this.getAccount(0);
  }

  /**
   * Returns the Ethereum address for an account index.
   *
   * @param index - BIP-44 account index (default: 0)
   */
  async getAddress(index = 0): Promise<string> {
    const account = await this.getAccount(index);
    return account.getAddress();
  }

  /**
   * Returns current fee rates from the network.
   * Used by the decision engine to factor gas costs into EV calculations.
   */
  async getFeeRates(): Promise<{ normal: bigint; fast: bigint }> {
    return this.manager.getFeeRates();
  }

  /**
   * Disposes all wallet accounts, wiping private keys from memory.
   * MUST be called on agent shutdown to prevent key leakage.
   */
  dispose(): void {
    this.manager.dispose();
  }
}

/**
 * Factory: creates an AgentWallet from environment variables.
 * Throws clearly if required vars are missing.
 */
export function createAgentWallet(): AgentWallet {
  const seed = process.env["AGENT_SEED_PHRASE"];
  const rpcUrl = process.env["RPC_URL"];

  if (!seed) {
    throw new Error(
      "Missing env var AGENT_SEED_PHRASE. Set it in your .env file."
    );
  }
  if (!rpcUrl) {
    throw new Error("Missing env var RPC_URL. Set it in your .env file.");
  }

  const maxFeeStr = process.env["WALLET_MAX_FEE_WEI"];
  const transferMaxFee = maxFeeStr ? BigInt(maxFeeStr) : DEFAULT_MAX_FEE;

  return new AgentWallet(seed, { rpcUrl, transferMaxFee });
}
