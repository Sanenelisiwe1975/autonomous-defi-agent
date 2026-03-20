// test/StrategyManager.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");

const Outcome = { INVALID: 0n, YES: 1n, NO: 2n };
const BundleType = { ENTER_LONG: 0n, EXIT: 1n, LP_DEPLOY: 2n, LP_RECALL: 3n, REBALANCE: 4n, CLAIM: 5n };

const ZERO = ethers.ZeroAddress;
const ZERO32 = ethers.ZeroHash;

async function deploy() {
  const [owner, agentKey, executor, alice] = await ethers.getSigners();

  const MockVault = await ethers.getContractFactory("MockAgentVault");
  const vault = await MockVault.deploy();
  await vault.waitForDeployment();

  const SM = await ethers.getContractFactory("StrategyManager");
  const manager = await SM.deploy(await vault.getAddress(), agentKey.address);
  await manager.waitForDeployment();

  return { manager, vault, owner, agentKey, executor, alice };
}

function makeBundle(overrides = {}) {
  return {
    bundleType:       overrides.bundleType      ?? BundleType.ENTER_LONG,
    marketIdA:        overrides.marketIdA       ?? ethers.keccak256(ethers.toUtf8Bytes("mA")),
    marketIdB:        overrides.marketIdB       ?? ZERO32,
    marketAddrA:      overrides.marketAddrA     ?? ZERO,
    marketAddrB:      overrides.marketAddrB     ?? ZERO,
    collateralToken:  overrides.collateralToken ?? ZERO,
    amount:           overrides.amount          ?? 1_000n,
    outcomeA:         overrides.outcomeA        ?? Outcome.YES,
    outcomeB:         overrides.outcomeB        ?? Outcome.INVALID,
    minOut:           overrides.minOut          ?? 0n,
    deadline:         overrides.deadline        ?? BigInt(Math.floor(Date.now() / 1000)) + 3_600n,
    nonce:            overrides.nonce           ?? 1n,
  };
}

async function signBundle(signer, manager, bundle) {
  const domainSep = await manager.DOMAIN_SEPARATOR();
  const BUNDLE_TYPEHASH = await manager.BUNDLE_TYPEHASH();

  const structHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32","uint8","bytes32","bytes32","address","address","address",
       "uint256","uint8","uint8","uint256","uint256","uint256"],
      [
        BUNDLE_TYPEHASH,
        bundle.bundleType,
        bundle.marketIdA,
        bundle.marketIdB,
        bundle.marketAddrA,
        bundle.marketAddrB,
        bundle.collateralToken,
        bundle.amount,
        bundle.outcomeA,
        bundle.outcomeB,
        bundle.minOut,
        bundle.deadline,
        bundle.nonce,
      ]
    )
  );
  const digest = ethers.keccak256(
    ethers.concat([
      ethers.toUtf8Bytes("\x19\x01"),
      ethers.getBytes(domainSep),
      ethers.getBytes(structHash),
    ])
  );
  // Use signMessage so the private key signs the raw digest (not the prefixed one again)
  return signer.signingKey.sign(digest);
}

function sigToBytes(sig) {
  return ethers.concat([sig.r, sig.s, ethers.toBeHex(sig.v, 1)]);
}

describe("StrategyManager", function () {

  describe("Deployment", () => {
    it("stores vault, agentKey, owner and DOMAIN_SEPARATOR", async () => {
      const { manager, vault, owner, agentKey } = await deploy();
      expect(await manager.vault()).to.equal(await vault.getAddress());
      expect(await manager.agentKey()).to.equal(agentKey.address);
      expect(await manager.owner()).to.equal(owner.address);
      expect(await manager.DOMAIN_SEPARATOR()).to.not.equal(ZERO32);
    });
  });

  describe("Admin", () => {
    it("owner adds approved executor", async () => {
      const { manager, owner, executor } = await deploy();
      await expect(manager.connect(owner).setExecutor(executor.address, true))
        .to.emit(manager, "ExecutorSet")
        .withArgs(executor.address, true);
      expect(await manager.approvedExecutors(executor.address)).to.equal(true);
    });

    it("owner revokes executor", async () => {
      const { manager, owner, executor } = await deploy();
      await manager.connect(owner).setExecutor(executor.address, true);
      await manager.connect(owner).setExecutor(executor.address, false);
      expect(await manager.approvedExecutors(executor.address)).to.equal(false);
    });

    it("owner rotates agent key", async () => {
      const { manager, owner, alice } = await deploy();
      await expect(manager.connect(owner).rotateAgentKey(alice.address))
        .to.emit(manager, "AgentKeyRotated")
        .withArgs(alice.address);
      expect(await manager.agentKey()).to.equal(alice.address);
    });

    it("non-owner cannot call admin functions", async () => {
      const { manager, alice, executor } = await deploy();
      await expect(manager.connect(alice).setExecutor(executor.address, true))
        .to.be.revertedWithCustomError(manager, "Unauthorized");
      await expect(manager.connect(alice).rotateAgentKey(alice.address))
        .to.be.revertedWithCustomError(manager, "Unauthorized");
    });
  });

  describe("directExecute()", () => {
    it("agentKey can directly execute a bundle", async () => {
      const { manager, agentKey } = await deploy();
      const bundle = makeBundle({ bundleType: BundleType.ENTER_LONG });
      await expect(manager.connect(agentKey).directExecute(bundle))
        .to.emit(manager, "BundleExecuted");
    });

    it("marks nonce as used", async () => {
      const { manager, agentKey } = await deploy();
      const bundle = makeBundle({ nonce: 42n });
      await manager.connect(agentKey).directExecute(bundle);
      expect(await manager.usedNonces(42n)).to.equal(true);
    });

    it("reverts NonceUsed on replay", async () => {
      const { manager, agentKey } = await deploy();
      const bundle = makeBundle({ nonce: 7n });
      await manager.connect(agentKey).directExecute(bundle);
      await expect(manager.connect(agentKey).directExecute(bundle))
        .to.be.revertedWithCustomError(manager, "NonceUsed");
    });

    it("reverts BundleExpired for past deadline", async () => {
      const { manager, agentKey } = await deploy();
      const bundle = makeBundle({ deadline: 1n }); // epoch = long past
      await expect(manager.connect(agentKey).directExecute(bundle))
        .to.be.revertedWithCustomError(manager, "BundleExpired");
    });

    it("reverts Unauthorized for non-agentKey", async () => {
      const { manager, alice } = await deploy();
      const bundle = makeBundle();
      await expect(manager.connect(alice).directExecute(bundle))
        .to.be.revertedWithCustomError(manager, "Unauthorized");
    });
  });

  describe("executeBundle()", () => {
    it("approved executor executes a signed bundle", async () => {
      const { manager, owner, agentKey, executor } = await deploy();
      await manager.connect(owner).setExecutor(executor.address, true);

      const bundle = makeBundle({ nonce: 100n });
      const sig    = await signBundle(agentKey, manager, bundle);
      const sigBytes = sigToBytes(sig);

      await expect(manager.connect(executor).executeBundle(bundle, sigBytes))
        .to.emit(manager, "BundleExecuted");
    });

    it("agentKey can self-submit signed bundle", async () => {
      const { manager, agentKey } = await deploy();
      const bundle = makeBundle({ nonce: 200n });
      const sig    = await signBundle(agentKey, manager, bundle);
      await expect(manager.connect(agentKey).executeBundle(bundle, sigToBytes(sig)))
        .to.emit(manager, "BundleExecuted");
    });

    it("reverts InvalidSignature for wrong signer", async () => {
      const { manager, owner, executor, alice } = await deploy();
      await manager.connect(owner).setExecutor(executor.address, true);
      const bundle = makeBundle({ nonce: 300n });
      // alice signs instead of agentKey
      const sig = await signBundle(alice, manager, bundle);
      await expect(manager.connect(executor).executeBundle(bundle, sigToBytes(sig)))
        .to.be.revertedWithCustomError(manager, "InvalidSignature");
    });

    it("reverts Unauthorized for non-executor, non-agentKey", async () => {
      const { manager, agentKey, alice } = await deploy();
      const bundle = makeBundle({ nonce: 400n });
      const sig    = await signBundle(agentKey, manager, bundle);
      await expect(manager.connect(alice).executeBundle(bundle, sigToBytes(sig)))
        .to.be.revertedWithCustomError(manager, "Unauthorized");
    });

    it("reverts NonceUsed on replay via executeBundle", async () => {
      const { manager, agentKey } = await deploy();
      const bundle = makeBundle({ nonce: 500n });
      const sig    = await signBundle(agentKey, manager, bundle);
      const sigB   = sigToBytes(sig);
      await manager.connect(agentKey).executeBundle(bundle, sigB);
      await expect(manager.connect(agentKey).executeBundle(bundle, sigB))
        .to.be.revertedWithCustomError(manager, "NonceUsed");
    });

    it("updates strategyRecord on execution", async () => {
      const { manager, agentKey } = await deploy();
      const mId   = ethers.keccak256(ethers.toUtf8Bytes("mA"));
      const bundle = makeBundle({ nonce: 600n, marketIdA: mId, amount: 777n });
      const sig    = await signBundle(agentKey, manager, bundle);
      await manager.connect(agentKey).executeBundle(bundle, sigToBytes(sig));
      const rec = await manager.getStrategyRecord(mId);
      expect(rec.totalDeployed).to.equal(777n);
      expect(rec.executionCount).to.equal(1n);
    });
  });

  describe("Bundle type dispatch", () => {
    const TYPES = [
      BundleType.ENTER_LONG,
      BundleType.EXIT,
      BundleType.LP_DEPLOY,
      BundleType.LP_RECALL,
      BundleType.REBALANCE,
      BundleType.CLAIM,
    ];
    const NAMES = ["ENTER_LONG","EXIT","LP_DEPLOY","LP_RECALL","REBALANCE","CLAIM"];

    TYPES.forEach((bt, i) => {
      it(`dispatches ${NAMES[i]} without revert`, async () => {
        const { manager, agentKey } = await deploy();
        const bundle = makeBundle({ bundleType: bt, nonce: BigInt(i + 1) });
        await expect(manager.connect(agentKey).directExecute(bundle)).not.to.be.reverted;
      });
    });
  });
});