// test/MarketResolver.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const { USDT_UNIT, DAY, DISPUTE_BOND } = require("./helpers");

// OutcomeIndex enum: INVALID=0, YES=1, NO=2
const Outcome = { INVALID: 0n, YES: 1n, NO: 2n };
const DISPUTE_PERIOD = 48n * 3_600n; // 48 hours in seconds

async function deployResolver() {
  const signers = await ethers.getSigners();
  const [owner, aiOracle, challenger, c1, c2, c3, c4, c5, alice] = signers;

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdt = await MockERC20.deploy("Mock USDT","USDT",6);
  await usdt.waitForDeployment();
  await usdt.mint(challenger.address, 10_000n * USDT_UNIT);

  const Resolver = await ethers.getContractFactory("MarketResolver");
  const resolver = await Resolver.deploy(
    owner.address,
    await usdt.getAddress(),
    [c1.address, c2.address, c3.address, c4.address, c5.address],
    aiOracle.address
  );
  await resolver.waitForDeployment();

  const resolverAddr = await resolver.getAddress();
  await usdt.connect(challenger).approve(resolverAddr, ethers.MaxUint256);

  // Deploy a mock PredictionMarket for resolve() calls
  const MockERC20b = await ethers.getContractFactory("MockERC20");
  const usdtB = await MockERC20b.deploy("Mock USDT B","USDTB",6);
  await usdtB.waitForDeployment();
  await usdtB.mint(owner.address, 2_000n * USDT_UNIT);

  const now = BigInt(await time.latest());
  await usdtB.connect(owner).approve(
    ethers.getCreateAddress({ from: owner.address, nonce: (await ethers.provider.getTransactionCount(owner.address)) + 1 }),
    ethers.MaxUint256
  );
  const PM = await ethers.getContractFactory("PredictionMarket");
  const market = await PM.connect(owner).deploy(
    "Test market",
    await usdtB.getAddress(),
    now + 7n * DAY,
    1_000n * USDT_UNIT,
    1_000n * USDT_UNIT,
    100n,
    owner.address
  );
  await market.waitForDeployment();
  await market.connect(owner).setResolver(resolverAddr);

  const marketId = ethers.keccak256(ethers.toUtf8Bytes("market-1"));
  await resolver.connect(owner).registerMarket(marketId, await market.getAddress());

  return {
    resolver, usdt, market, owner, aiOracle, challenger,
    committee: [c1, c2, c3, c4, c5], alice, marketId
  };
}

describe("MarketResolver", function () {

  // ── Deployment ──────────────────────────────────────────────────────────────
  describe("Deployment", () => {
    it("stores owner, collateralToken, aiOracle", async () => {
      const { resolver, usdt, owner, aiOracle } = await deployResolver();
      expect(await resolver.owner()).to.equal(owner.address);
      expect(await resolver.collateralToken()).to.equal(await usdt.getAddress());
      expect(await resolver.aiOracle()).to.equal(aiOracle.address);
    });

    it("marks committee members correctly", async () => {
      const { resolver, committee } = await deployResolver();
      for (const m of committee) {
        expect(await resolver.isCommitteeMember(m.address)).to.equal(true);
      }
    });
  });

  // ── registerMarket ───────────────────────────────────────────────────────────
  describe("registerMarket()", () => {
    it("owner registers a market", async () => {
      const { resolver, owner } = await deployResolver();
      const id = ethers.keccak256(ethers.toUtf8Bytes("new-market"));
      await expect(resolver.connect(owner).registerMarket(id, ethers.ZeroAddress))
        .to.emit(resolver, "MarketRegistered");
    });

    it("reverts for non-owner", async () => {
      const { resolver, alice } = await deployResolver();
      const id = ethers.keccak256(ethers.toUtf8Bytes("x"));
      await expect(resolver.connect(alice).registerMarket(id, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(resolver, "Unauthorized");
    });
  });

  // ── proposeResolution ────────────────────────────────────────────────────────
  describe("proposeResolution()", () => {
    it("committee member proposes a resolution", async () => {
      const { resolver, committee, marketId } = await deployResolver();
      await expect(resolver.connect(committee[0]).proposeResolution(marketId, Outcome.YES))
        .to.emit(resolver, "ResolutionProposed");
      const res = await resolver.getResolution(marketId);
      expect(res.outcome).to.equal(Outcome.YES);
    });

    it("owner can propose resolution", async () => {
      const { resolver, owner, marketId } = await deployResolver();
      await resolver.connect(owner).proposeResolution(marketId, Outcome.NO);
      const res = await resolver.getResolution(marketId);
      expect(res.outcome).to.equal(Outcome.NO);
    });

    it("reverts for unauthorized caller", async () => {
      const { resolver, alice, marketId } = await deployResolver();
      await expect(resolver.connect(alice).proposeResolution(marketId, Outcome.YES))
        .to.be.revertedWithCustomError(resolver, "Unauthorized");
    });

    it("reverts for unregistered market", async () => {
      const { resolver, committee } = await deployResolver();
      const badId = ethers.keccak256(ethers.toUtf8Bytes("unregistered"));
      await expect(resolver.connect(committee[0]).proposeResolution(badId, Outcome.YES))
        .to.be.revertedWithCustomError(resolver, "MarketNotRegistered");
    });
  });

  // ── aiResolve ────────────────────────────────────────────────────────────────
  describe("aiResolve()", () => {
    it("aiOracle can propose resolution with rationale", async () => {
      const { resolver, aiOracle, marketId } = await deployResolver();
      await expect(
        resolver.connect(aiOracle).aiResolve(marketId, Outcome.YES, "Price > $10k at expiry")
      ).to.emit(resolver, "ResolutionProposed");
      const res = await resolver.getResolution(marketId);
      expect(res.source).to.equal(2n); // AI_ORACLE
    });

    it("owner can also call aiResolve", async () => {
      const { resolver, owner, marketId } = await deployResolver();
      await resolver.connect(owner).aiResolve(marketId, Outcome.NO, "rationale");
      const res = await resolver.getResolution(marketId);
      expect(res.source).to.equal(2n);
    });

    it("reverts for INVALID outcome", async () => {
      const { resolver, aiOracle, marketId } = await deployResolver();
      await expect(
        resolver.connect(aiOracle).aiResolve(marketId, Outcome.INVALID, "bad")
      ).to.be.revertedWithCustomError(resolver, "InvalidOutcome");
    });

    it("reverts for unauthorized caller", async () => {
      const { resolver, alice, marketId } = await deployResolver();
      await expect(resolver.connect(alice).aiResolve(marketId, Outcome.YES, "hack"))
        .to.be.revertedWithCustomError(resolver, "Unauthorized");
    });
  });

  // ── finalizeResolution ───────────────────────────────────────────────────────
  describe("finalizeResolution()", () => {
    it("finalizes after AI_ORACLE 24h window and calls market.resolve()", async () => {
      const { resolver, aiOracle, market, marketId } = await deployResolver();
      await resolver.connect(aiOracle).aiResolve(marketId, Outcome.YES, "rationale");

      await time.increase(24n * 3_600n + 1n); // 24h window for AI_ORACLE
      await expect(resolver.finalizeResolution(marketId))
        .to.emit(resolver, "ResolutionFinalized")
        .withArgs(marketId, Outcome.YES);

      // PredictionMarket should now be resolved
      expect(await market.resolvedOutcome()).to.equal(1n); // YES = 1
    });

    it("finalizes after 48h window for MULTISIG resolution", async () => {
      const { resolver, committee, market, marketId } = await deployResolver();
      await resolver.connect(committee[0]).proposeResolution(marketId, Outcome.NO);
      await time.increase(DISPUTE_PERIOD + 1n);
      await expect(resolver.finalizeResolution(marketId)).not.to.be.reverted;
      expect(await market.resolvedOutcome()).to.equal(2n); // NO = 2
    });

    it("reverts if dispute window still active", async () => {
      const { resolver, aiOracle, marketId } = await deployResolver();
      await resolver.connect(aiOracle).aiResolve(marketId, Outcome.YES, "r");
      await expect(resolver.finalizeResolution(marketId))
        .to.be.revertedWith("Dispute period still active");
    });

    it("reverts if already finalized", async () => {
      const { resolver, aiOracle, marketId } = await deployResolver();
      await resolver.connect(aiOracle).aiResolve(marketId, Outcome.YES, "r");
      await time.increase(24n * 3_600n + 1n);
      await resolver.finalizeResolution(marketId);
      await expect(resolver.finalizeResolution(marketId))
        .to.be.revertedWith("Already finalized");
    });

    it("reverts if no resolution was proposed", async () => {
      const { resolver, marketId } = await deployResolver();
      await expect(resolver.finalizeResolution(marketId))
        .to.be.revertedWith("No resolution proposed");
    });
  });

  describe("raiseDispute()", () => {
    it("challenger raises a dispute with bond", async () => {
      const { resolver, usdt, aiOracle, challenger, marketId } = await deployResolver();
      await resolver.connect(aiOracle).aiResolve(marketId, Outcome.YES, "r");

      await expect(resolver.connect(challenger).raiseDispute(marketId, "Disagree"))
        .to.emit(resolver, "DisputeRaised")
        .withArgs(marketId, challenger.address, "Disagree");

      const dis = await resolver.getDispute(marketId);
      expect(dis.state).to.equal(1n); // PENDING
      expect(dis.bondAmount).to.equal(DISPUTE_BOND);
    });

    it("reverts AlreadyDisputed on duplicate", async () => {
      const { resolver, usdt, aiOracle, challenger, marketId } = await deployResolver();
      await resolver.connect(aiOracle).aiResolve(marketId, Outcome.YES, "r");
      await resolver.connect(challenger).raiseDispute(marketId, "first");
      await expect(resolver.connect(challenger).raiseDispute(marketId, "second"))
        .to.be.revertedWithCustomError(resolver, "AlreadyDisputed");
    });

    it("reverts after dispute window closed", async () => {
      const { resolver, aiOracle, challenger, marketId } = await deployResolver();
      await resolver.connect(aiOracle).aiResolve(marketId, Outcome.YES, "r");
      await time.increase(DISPUTE_PERIOD + 1n);
      await expect(resolver.connect(challenger).raiseDispute(marketId, "late"))
        .to.be.revertedWith("Dispute window closed");
    });
  });

  describe("voteOnDispute()", () => {
    async function setupDispute(yesWon = true) {
      const ctx = await deployResolver();
      await ctx.resolver.connect(ctx.aiOracle).aiResolve(ctx.marketId, Outcome.YES, "r");
      await ctx.resolver.connect(ctx.challenger).raiseDispute(ctx.marketId, "Dispute it");
      return ctx;
    }

    it("committee reaches quorum — dispute REJECTED (original upheld)", async () => {
      const { resolver, committee, marketId } = await setupDispute();
      await resolver.connect(committee[0]).voteOnDispute(marketId, Outcome.YES);
      await resolver.connect(committee[1]).voteOnDispute(marketId, Outcome.YES);
      await expect(resolver.connect(committee[2]).voteOnDispute(marketId, Outcome.YES))
        .to.emit(resolver, "DisputeResolved");

      const dis = await resolver.getDispute(marketId);
      expect(dis.state).to.equal(3n); // REJECTED
    });

    it("committee reaches quorum — dispute UPHELD (outcome overridden)", async () => {
      const { resolver, committee, marketId } = await setupDispute();
      // Vote NO (different from original YES) — upheld means dispute accepted, outcome flips
      await resolver.connect(committee[0]).voteOnDispute(marketId, Outcome.NO);
      await resolver.connect(committee[1]).voteOnDispute(marketId, Outcome.NO);
      await expect(resolver.connect(committee[2]).voteOnDispute(marketId, Outcome.NO))
        .to.emit(resolver, "DisputeResolved");

      const dis = await resolver.getDispute(marketId);
      expect(dis.state).to.equal(2n); // UPHELD

      const res = await resolver.getResolution(marketId);
      expect(res.outcome).to.equal(Outcome.NO); // overridden
    });

    it("bond returned to challenger when dispute UPHELD", async () => {
      const { resolver, usdt, committee, challenger, marketId } = await setupDispute();
      const before = await usdt.balanceOf(challenger.address);
      await resolver.connect(committee[0]).voteOnDispute(marketId, Outcome.NO);
      await resolver.connect(committee[1]).voteOnDispute(marketId, Outcome.NO);
      await resolver.connect(committee[2]).voteOnDispute(marketId, Outcome.NO);
      const after = await usdt.balanceOf(challenger.address);
      expect(after - before).to.equal(DISPUTE_BOND);
    });

    it("reverts AlreadyVoted for same member", async () => {
      const { resolver, committee, marketId } = await setupDispute();
      await resolver.connect(committee[0]).voteOnDispute(marketId, Outcome.YES);
      await expect(resolver.connect(committee[0]).voteOnDispute(marketId, Outcome.YES))
        .to.be.revertedWithCustomError(resolver, "AlreadyVoted");
    });

    it("reverts NotCommitteeMember for non-member", async () => {
      const { resolver, alice, marketId } = await setupDispute();
      await expect(resolver.connect(alice).voteOnDispute(marketId, Outcome.YES))
        .to.be.revertedWithCustomError(resolver, "NotCommitteeMember");
    });
  });

  // ── Admin ────────────────────────────────────────────────────────────────────
  describe("Admin", () => {
    it("owner sets new aiOracle", async () => {
      const { resolver, owner, alice } = await deployResolver();
      await resolver.connect(owner).setAiOracle(alice.address);
      expect(await resolver.aiOracle()).to.equal(alice.address);
    });

    it("owner sets Chainlink feed", async () => {
      const { resolver, owner, marketId, alice } = await deployResolver();
      await expect(resolver.connect(owner).setChainlinkFeed(marketId, alice.address, 3000n * 10n**8n))
        .to.emit(resolver, "ChainlinkFeedSet");
      expect(await resolver.chainlinkFeeds(marketId)).to.equal(alice.address);
    });

    it("non-owner cannot call admin functions", async () => {
      const { resolver, alice, marketId } = await deployResolver();
      await expect(resolver.connect(alice).setAiOracle(alice.address))
        .to.be.revertedWithCustomError(resolver, "Unauthorized");
      await expect(resolver.connect(alice).setChainlinkFeed(marketId, alice.address, 0n))
        .to.be.revertedWithCustomError(resolver, "Unauthorized");
    });
  });
});