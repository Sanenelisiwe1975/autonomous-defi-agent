// test/PredictionMarket.test.js
const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");
const { USDT_UNIT, DAY, DEFAULT_FEE_BPS } = require("./helpers");


async function deployMarket(overrides = {}) {
  const [owner, alice, bob, resolver] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdt = await MockERC20.deploy("Mock USDT", "USDT", 6);
  await usdt.waitForDeployment();

  const now     = BigInt(await time.latest());
  const closing = overrides.closingTime ?? now + 7n * DAY;
  const seedY   = overrides.seedYes ?? 1_000n * USDT_UNIT;
  const seedN   = overrides.seedNo  ?? 1_000n * USDT_UNIT;
  const seed    = seedY + seedN;

  // Mint seed to owner and approve the soon-to-be market address.
  // Because the constructor pulls from owner, we need to pre-approve.
  // We deploy a helper first just to get the nonce, then approve MaxUint256.
  await usdt.mint(owner.address, seed + 100_000n * USDT_UNIT); // extra for tests
  await usdt.mint(alice.address, 10_000n * USDT_UNIT);
  await usdt.mint(bob.address,   10_000n * USDT_UNIT);

  const PM = await ethers.getContractFactory("PredictionMarket");

  // Pre-deploy to get the expected address, then approve
  // Easier: deploy with seed=0, then fund separately — but the constructor
  // requires owner to have approved. We approve max before deploying.
  await usdt.connect(owner).approve(
    // We don't know the address yet, so approve using a create2 simulation.
    // Simplest workaround: deploy once with zero seed, then re-deploy with seed.
    ethers.ZeroAddress, 0n
  );

  // Proper approach: compute future address from nonce
  const nonce = await ethers.provider.getTransactionCount(owner.address);
  const futureAddr = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 1 });
  await usdt.connect(owner).approve(futureAddr, ethers.MaxUint256);

  const market = await PM.connect(owner).deploy(
    overrides.question    ?? "Will ETH hit $10k?",
    await usdt.getAddress(),
    closing,
    seedY,
    seedN,
    overrides.feeBps ?? DEFAULT_FEE_BPS,
    owner.address
  );
  await market.waitForDeployment();

  const marketAddr = await market.getAddress();
  await usdt.connect(alice).approve(marketAddr, ethers.MaxUint256);
  await usdt.connect(bob).approve(marketAddr,   ethers.MaxUint256);

  const yesToken = await ethers.getContractAt("OutcomeToken", await market.yesToken());
  const noToken  = await ethers.getContractAt("OutcomeToken", await market.noToken());

  return { market, usdt, yesToken, noToken, owner, alice, bob, resolver, closing };
}


describe("PredictionMarket", function () {

  describe("Deployment", () => {
    it("stores question, usdt, closing time, feeBps", async () => {
      const { market, usdt, closing } = await deployMarket();
      expect(await market.question()).to.equal("Will ETH hit $10k?");
      expect(await market.usdt()).to.equal(await usdt.getAddress());
      expect(await market.closingTime()).to.equal(closing);
      expect(await market.feeBps()).to.equal(DEFAULT_FEE_BPS);
    });

    it("deploys YES and NO outcome tokens", async () => {
      const { yesToken, noToken } = await deployMarket();
      expect(await yesToken.symbol()).to.equal("YES");
      expect(await noToken.symbol()).to.equal("NO");
    });

    it("seeds initial reserves and mints to owner", async () => {
      const { market, yesToken, noToken, owner } = await deployMarket();
      expect(await market.yesReserve()).to.equal(1_000n * USDT_UNIT);
      expect(await market.noReserve()).to.equal(1_000n * USDT_UNIT);
      expect(await yesToken.balanceOf(owner.address)).to.equal(1_000n * USDT_UNIT);
      expect(await noToken.balanceOf(owner.address)).to.equal(1_000n * USDT_UNIT);
    });

    it("resolvedOutcome starts UNRESOLVED (0)", async () => {
      const { market } = await deployMarket();
      expect(await market.resolvedOutcome()).to.equal(0n); // UNRESOLVED
    });
  });

  describe("enterPosition()", () => {
    it("mints YES tokens and updates reserve", async () => {
      const { market, yesToken, alice } = await deployMarket();
      const usdtIn = 100n * USDT_UNIT;

      const fee    = (usdtIn * DEFAULT_FEE_BPS) / 10_000n;
      const netIn  = usdtIn - fee;
      const noRes  = 1_000n * USDT_UNIT;
      const yesRes = 1_000n * USDT_UNIT;
      const expected = (netIn * noRes) / (yesRes + netIn);

      const tx = await market.connect(alice).enterPosition(true, usdtIn, 0n);
      await expect(tx)
        .to.emit(market, "PositionEntered")
        .withArgs(alice.address, true, usdtIn, expected);

      expect(await yesToken.balanceOf(alice.address)).to.equal(expected);
      expect(await market.yesReserve()).to.equal(yesRes + netIn);
    });

    it("mints NO tokens and updates reserve", async () => {
      const { market, noToken, alice } = await deployMarket();
      const usdtIn = 200n * USDT_UNIT;
      const fee    = (usdtIn * DEFAULT_FEE_BPS) / 10_000n;
      const netIn  = usdtIn - fee;
      const noRes  = 1_000n * USDT_UNIT;
      const yesRes = 1_000n * USDT_UNIT;
      const expected = (netIn * yesRes) / (noRes + netIn);

      await market.connect(alice).enterPosition(false, usdtIn, 0n);
      expect(await noToken.balanceOf(alice.address)).to.equal(expected);
    });

    it("accrues fees correctly", async () => {
      const { market, alice } = await deployMarket();
      const usdtIn = 1_000n * USDT_UNIT;
      await market.connect(alice).enterPosition(true, usdtIn, 0n);
      const expectedFee = (usdtIn * DEFAULT_FEE_BPS) / 10_000n;
      expect(await market.accruedFees()).to.equal(expectedFee);
    });

    it("reverts with ZeroAmount", async () => {
      const { market, alice } = await deployMarket();
      await expect(market.connect(alice).enterPosition(true, 0n, 0n))
        .to.be.revertedWithCustomError(market, "ZeroAmount");
    });

    it("reverts after market closing time (MarketClosed)", async () => {
      const { market, alice, closing } = await deployMarket();
      await time.increaseTo(closing + 1n);
      await expect(market.connect(alice).enterPosition(true, 100n * USDT_UNIT, 0n))
        .to.be.revertedWithCustomError(market, "MarketClosed");
    });

    it("reverts when market is already resolved (MarketAlreadyResolved)", async () => {
      const { market, alice, owner } = await deployMarket();
      await market.connect(owner).resolve(true);
      await expect(market.connect(alice).enterPosition(true, 100n * USDT_UNIT, 0n))
        .to.be.revertedWithCustomError(market, "MarketAlreadyResolved");
    });

    it("reverts on slippage (InsufficientOutput)", async () => {
      const { market, alice } = await deployMarket();
      await expect(
        market.connect(alice).enterPosition(true, 100n * USDT_UNIT, ethers.MaxUint256)
      ).to.be.revertedWithCustomError(market, "InsufficientOutput");
    });
  });

  describe("resolve()", () => {
    it("owner can resolve YES", async () => {
      const { market, owner } = await deployMarket();
      await expect(market.connect(owner).resolve(true))
        .to.emit(market, "MarketResolved")
        .withArgs(1n); // Outcome.YES = 1
      expect(await market.resolvedOutcome()).to.equal(1n);
    });

    it("owner can resolve NO", async () => {
      const { market, owner } = await deployMarket();
      await market.connect(owner).resolve(false);
      expect(await market.resolvedOutcome()).to.equal(2n); // Outcome.NO = 2
    });

    it("registered resolver can resolve", async () => {
      const { market, owner, resolver } = await deployMarket();
      await market.connect(owner).setResolver(resolver.address);
      await expect(market.connect(resolver).resolve(true)).not.to.be.reverted;
    });

    it("reverts for unauthorized caller", async () => {
      const { market, alice } = await deployMarket();
      await expect(market.connect(alice).resolve(true))
        .to.be.revertedWith("PredictionMarket: not owner or resolver");
    });

    it("reverts when already resolved (MarketAlreadyResolved)", async () => {
      const { market, owner } = await deployMarket();
      await market.connect(owner).resolve(true);
      await expect(market.connect(owner).resolve(false))
        .to.be.revertedWithCustomError(market, "MarketAlreadyResolved");
    });
  });

  describe("redeem()", () => {
    it("winner redeems YES tokens for USDT proportionally", async () => {
      const { market, usdt, yesToken, alice, bob, owner } = await deployMarket();

      const stake = 500n * USDT_UNIT;
      await market.connect(alice).enterPosition(true,  stake, 0n);
      await market.connect(bob).enterPosition(false, stake, 0n);

      await market.connect(owner).resolve(true);

      const aliceTokens  = await yesToken.balanceOf(alice.address);
      const ownerTokens  = await yesToken.balanceOf(owner.address); // seeded
      const winningSupply = await yesToken.totalSupply();
      const pot          = await market.totalDeposited() - await market.accruedFees();
      const expectedOut  = (aliceTokens * pot) / winningSupply;

      const balBefore = await usdt.balanceOf(alice.address);
      await expect(market.connect(alice).redeem(aliceTokens))
        .to.emit(market, "Redeemed");
      const balAfter = await usdt.balanceOf(alice.address);

      expect(balAfter - balBefore).to.equal(expectedOut);
    });

    it("reverts when market not resolved (MarketNotResolved)", async () => {
      const { market, alice, owner, yesToken } = await deployMarket();
      await market.connect(alice).enterPosition(true, 100n * USDT_UNIT, 0n);
      const tokens = await yesToken.balanceOf(alice.address);
      await expect(market.connect(alice).redeem(tokens))
        .to.be.revertedWithCustomError(market, "MarketNotResolved");
    });

    it("reverts with ZeroAmount", async () => {
      const { market, owner } = await deployMarket();
      await market.connect(owner).resolve(true);
      await expect(market.connect(owner).redeem(0n))
        .to.be.revertedWithCustomError(market, "ZeroAmount");
    });
  });

  describe("claimFees()", () => {
    it("owner claims accrued fees", async () => {
      const { market, usdt, alice, owner } = await deployMarket();
      await market.connect(alice).enterPosition(true, 1_000n * USDT_UNIT, 0n);
      const fees = await market.accruedFees();
      expect(fees).to.be.gt(0n);

      const before = await usdt.balanceOf(owner.address);
      await expect(market.connect(owner).claimFees())
        .to.emit(market, "FeesClaimed")
        .withArgs(owner.address, fees);

      expect(await usdt.balanceOf(owner.address)).to.equal(before + fees);
      expect(await market.accruedFees()).to.equal(0n);
    });

    it("reverts for non-owner", async () => {
      const { market, alice } = await deployMarket();
      await expect(market.connect(alice).claimFees())
        .to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");
    });
  });

  describe("impliedYesProbability()", () => {
    it("returns 5e17 for equal reserves", async () => {
      const { market } = await deployMarket();
      expect(await market.impliedYesProbability()).to.equal(5n * 10n ** 17n);
    });

    it("increases when NO reserve grows (YES bought)", async () => {
      const { market, alice } = await deployMarket();
      await market.connect(alice).enterPosition(true, 500n * USDT_UNIT, 0n);
      // buying YES adds to yesReserve, probability should shift
      const prob = await market.impliedYesProbability();
      expect(prob).to.be.lt(5n * 10n ** 17n);
    });
  });


  describe("quoteEnterPosition()", () => {
    it("matches actual tokens received", async () => {
      const { market, yesToken, alice } = await deployMarket();
      const usdtIn = 300n * USDT_UNIT;
      const quoted = await market.quoteEnterPosition(true, usdtIn);
      await market.connect(alice).enterPosition(true, usdtIn, 0n);
      expect(await yesToken.balanceOf(alice.address)).to.equal(quoted);
    });
  });

  describe("getMarketInfo()", () => {
    it("returns OPEN state before closing", async () => {
      const { market } = await deployMarket();
      const info = await market.getMarketInfo();
      expect(info.state).to.equal(0n); // OPEN
    });

    it("returns CLOSED state after closing time", async () => {
      const { market, closing } = await deployMarket();
      await time.increaseTo(closing + 1n);
      const info = await market.getMarketInfo();
      expect(info.state).to.equal(1n); // CLOSED
    });

    it("returns RESOLVED state and correct outcome", async () => {
      const { market, owner } = await deployMarket();
      await market.connect(owner).resolve(true);
      const info = await market.getMarketInfo();
      expect(info.state).to.equal(2n);      // RESOLVED
      expect(info.resolution).to.equal(1n); // YES
    });

    it("populates token addresses", async () => {
      const { market, yesToken, noToken } = await deployMarket();
      const info = await market.getMarketInfo();
      expect(info.yesToken).to.equal(await yesToken.getAddress());
      expect(info.noToken).to.equal(await noToken.getAddress());
    });
  });

  describe("setResolver()", () => {
    it("owner sets resolver", async () => {
      const { market, owner, resolver } = await deployMarket();
      await market.connect(owner).setResolver(resolver.address);
      expect(await market.resolver()).to.equal(resolver.address);
    });

    it("reverts for non-owner", async () => {
      const { market, alice, resolver } = await deployMarket();
      await expect(market.connect(alice).setResolver(resolver.address))
        .to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");
    });
  });
});