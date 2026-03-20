// test/ConditionalPayment.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const { USDT_UNIT, DAY } = require("./helpers");

const Outcome     = { INVALID: 0n, YES: 1n, NO: 2n };
const PayoffType  = { LINEAR: 0n, BINARY: 1n, CUSTOM: 2n };
const MarketState = { OPEN: 0n, CLOSED: 1n, RESOLVED: 2n };


async function deployMockMarket(state, resolution, yesTokenAddr, noTokenAddr) {
  const MockMarket = await ethers.getContractFactory("MockMarketForCP");
  const m = await MockMarket.deploy(state, resolution, yesTokenAddr, noTokenAddr);
  await m.waitForDeployment();
  return m;
}

async function deployCP() {
  const [owner, creator, beneficiary, alice] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdt = await MockERC20.deploy("Mock USDT","USDT",6);
  await usdt.waitForDeployment();
  await usdt.mint(creator.address, 100_000n * USDT_UNIT);

  const CP = await ethers.getContractFactory("ConditionalPayment");
  const cp = await CP.deploy(owner.address);
  await cp.waitForDeployment();

  await usdt.connect(creator).approve(await cp.getAddress(), ethers.MaxUint256);

  return { cp, usdt, owner, creator, beneficiary, alice };
}

// ── Create payment helper ─────────────────────────────────────────────────────
async function createPayment(cp, usdt, creator, beneficiary, marketAddr, overrides = {}) {
  const marketId = overrides.marketId ?? ethers.keccak256(ethers.toUtf8Bytes("m1"));
  const amount   = overrides.amount   ?? 1_000n * USDT_UNIT;
  const trigger  = overrides.trigger  ?? Outcome.YES;
  const payoff   = overrides.payoff   ?? PayoffType.BINARY;
  const expires  = overrides.expires  ?? BigInt(await time.latest()) + 30n * DAY;

  const tx = await cp.connect(creator).createPayment(
    beneficiary.address,
    marketAddr,
    marketId,
    await usdt.getAddress(),
    amount,
    trigger,
    payoff,
    "0x",
    expires
  );
  const receipt = await tx.wait();
  const event   = receipt.logs.find(l => l.fragment?.name === "PaymentCreated");
  return event.args.id;
}


describe("ConditionalPayment", function () {

  describe("createPayment()", () => {
    it("creates a payment and stores it", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();
      // Need a market address (use a dummy)
      const [,,,,alice] = await ethers.getSigners();

      const paymentId = await createPayment(cp, usdt, creator, beneficiary, alice.address);
      const p = await cp.getPayment(paymentId);

      expect(p.creator).to.equal(creator.address);
      expect(p.beneficiary).to.equal(beneficiary.address);
      expect(p.totalAmount).to.equal(1_000n * USDT_UNIT);
      expect(p.cancelled).to.equal(false);
    });

    it("transfers collateral from creator to contract", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();
      const [,,,,alice] = await ethers.getSigners();
      const amount = 500n * USDT_UNIT;

      const before = await usdt.balanceOf(await cp.getAddress());
      await createPayment(cp, usdt, creator, beneficiary, alice.address, { amount });
      expect(await usdt.balanceOf(await cp.getAddress())).to.equal(before + amount);
    });

    it("emits PaymentCreated event", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();
      const [,,,,alice] = await ethers.getSigners();
      const marketId = ethers.keccak256(ethers.toUtf8Bytes("m1"));

      await expect(
        cp.connect(creator).createPayment(
          beneficiary.address, alice.address, marketId,
          await usdt.getAddress(), 100n * USDT_UNIT,
          Outcome.YES, PayoffType.BINARY, "0x",
          BigInt(await time.latest()) + 30n * DAY
        )
      ).to.emit(cp, "PaymentCreated");
    });

    it("reverts with ZeroAddress for beneficiary", async () => {
      const { cp, usdt, creator } = await deployCP();
      const [,,,,alice] = await ethers.getSigners();
      const marketId = ethers.keccak256(ethers.toUtf8Bytes("m1"));
      await expect(
        cp.connect(creator).createPayment(
          ethers.ZeroAddress, alice.address, marketId,
          await usdt.getAddress(), 100n * USDT_UNIT,
          Outcome.YES, PayoffType.BINARY, "0x", 0n
        )
      ).to.be.revertedWithCustomError(cp, "ZeroAddress");
    });

    it("reverts with ZeroAmount", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();
      const [,,,,alice] = await ethers.getSigners();
      const marketId = ethers.keccak256(ethers.toUtf8Bytes("m1"));
      await expect(
        cp.connect(creator).createPayment(
          beneficiary.address, alice.address, marketId,
          await usdt.getAddress(), 0n,
          Outcome.YES, PayoffType.BINARY, "0x", 0n
        )
      ).to.be.revertedWithCustomError(cp, "ZeroAmount");
    });

    it("reverts when trigger is INVALID", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();
      const [,,,,alice] = await ethers.getSigners();
      const marketId = ethers.keccak256(ethers.toUtf8Bytes("m1"));
      await expect(
        cp.connect(creator).createPayment(
          beneficiary.address, alice.address, marketId,
          await usdt.getAddress(), 100n * USDT_UNIT,
          Outcome.INVALID, PayoffType.BINARY, "0x", 0n
        )
      ).to.be.revertedWithCustomError(cp, "NotTriggered");
    });

    it("registers in beneficiaryPayments and creatorPayments", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();
      const [,,,,alice] = await ethers.getSigners();

      const id = await createPayment(cp, usdt, creator, beneficiary, alice.address);
      const bps = await cp.getBeneficiaryPayments(beneficiary.address);
      const cps = await cp.getCreatorPayments(creator.address);
      expect(bps).to.include(id);
      expect(cps).to.include(id);
    });
  });

  describe("cancelPayment()", () => {
    it("creator cancels payment when market is OPEN", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();

      const MockMarketForCP = await ethers.getContractFactory("MockMarketForCP");
      const mockMarket = await MockMarketForCP.deploy(
        MarketState.OPEN, Outcome.INVALID, ethers.ZeroAddress, ethers.ZeroAddress
      );
      await mockMarket.waitForDeployment();

      const id = await createPayment(cp, usdt, creator, beneficiary, await mockMarket.getAddress());
      const before = await usdt.balanceOf(creator.address);

      await expect(cp.connect(creator).cancelPayment(id))
        .to.emit(cp, "PaymentCancelled").withArgs(id);

      expect((await cp.getPayment(id)).cancelled).to.equal(true);
      expect(await usdt.balanceOf(creator.address)).to.be.gt(before);
    });

    it("reverts Unauthorized for non-creator", async () => {
      const { cp, usdt, creator, beneficiary, alice } = await deployCP();
      const MockMarketForCP = await ethers.getContractFactory("MockMarketForCP");
      const mockMarket = await MockMarketForCP.deploy(
        MarketState.OPEN, Outcome.INVALID, ethers.ZeroAddress, ethers.ZeroAddress
      );
      await mockMarket.waitForDeployment();

      const id = await createPayment(cp, usdt, creator, beneficiary, await mockMarket.getAddress());
      await expect(cp.connect(alice).cancelPayment(id))
        .to.be.revertedWithCustomError(cp, "Unauthorized");
    });

    it("reverts Cancelled on double-cancel", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();
      const MockMarketForCP = await ethers.getContractFactory("MockMarketForCP");
      const mockMarket = await MockMarketForCP.deploy(
        MarketState.OPEN, Outcome.INVALID, ethers.ZeroAddress, ethers.ZeroAddress
      );
      await mockMarket.waitForDeployment();

      const id = await createPayment(cp, usdt, creator, beneficiary, await mockMarket.getAddress());
      await cp.connect(creator).cancelPayment(id);
      await expect(cp.connect(creator).cancelPayment(id))
        .to.be.revertedWithCustomError(cp, "Cancelled");
    });
  });

  describe("claimPayment()", () => {
    it("beneficiary claims BINARY payout when outcome matches", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();

      const MockMarketForCP = await ethers.getContractFactory("MockMarketForCP");
      const mockMarket = await MockMarketForCP.deploy(
        MarketState.RESOLVED, Outcome.YES, ethers.ZeroAddress, ethers.ZeroAddress
      );
      await mockMarket.waitForDeployment();

      const amount = 500n * USDT_UNIT;
      const id = await createPayment(cp, usdt, creator, beneficiary, await mockMarket.getAddress(), {
        amount, trigger: Outcome.YES, payoff: PayoffType.BINARY
      });

      const before = await usdt.balanceOf(beneficiary.address);
      await expect(cp.connect(beneficiary).claimPayment(id))
        .to.emit(cp, "PaymentClaimed");
      expect(await usdt.balanceOf(beneficiary.address)).to.equal(before + amount);
    });

    it("reverts Unauthorized for non-beneficiary", async () => {
      const { cp, usdt, creator, beneficiary, alice } = await deployCP();
      const MockMarketForCP = await ethers.getContractFactory("MockMarketForCP");
      const mockMarket = await MockMarketForCP.deploy(
        MarketState.RESOLVED, Outcome.YES, ethers.ZeroAddress, ethers.ZeroAddress
      );
      await mockMarket.waitForDeployment();

      const id = await createPayment(cp, usdt, creator, beneficiary, await mockMarket.getAddress(), {
        trigger: Outcome.YES
      });
      await expect(cp.connect(alice).claimPayment(id))
        .to.be.revertedWithCustomError(cp, "Unauthorized");
    });

    it("reverts NotTriggered when outcome doesn't match", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();
      const MockMarketForCP = await ethers.getContractFactory("MockMarketForCP");
      // Market resolved NO but payment triggers on YES
      const mockMarket = await MockMarketForCP.deploy(
        MarketState.RESOLVED, Outcome.NO, ethers.ZeroAddress, ethers.ZeroAddress
      );
      await mockMarket.waitForDeployment();

      const id = await createPayment(cp, usdt, creator, beneficiary, await mockMarket.getAddress(), {
        trigger: Outcome.YES
      });
      await expect(cp.connect(beneficiary).claimPayment(id))
        .to.be.revertedWithCustomError(cp, "NotTriggered");
    });

    it("reverts NotTriggered when market not yet RESOLVED", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();
      const MockMarketForCP = await ethers.getContractFactory("MockMarketForCP");
      const mockMarket = await MockMarketForCP.deploy(
        MarketState.OPEN, Outcome.INVALID, ethers.ZeroAddress, ethers.ZeroAddress
      );
      await mockMarket.waitForDeployment();

      const id = await createPayment(cp, usdt, creator, beneficiary, await mockMarket.getAddress(), {
        trigger: Outcome.YES
      });
      await expect(cp.connect(beneficiary).claimPayment(id))
        .to.be.revertedWithCustomError(cp, "NotTriggered");
    });

    it("reverts AlreadyClaimed on double-claim", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();
      const MockMarketForCP = await ethers.getContractFactory("MockMarketForCP");
      const mockMarket = await MockMarketForCP.deploy(
        MarketState.RESOLVED, Outcome.YES, ethers.ZeroAddress, ethers.ZeroAddress
      );
      await mockMarket.waitForDeployment();

      const id = await createPayment(cp, usdt, creator, beneficiary, await mockMarket.getAddress(), {
        trigger: Outcome.YES
      });
      await cp.connect(beneficiary).claimPayment(id);
      await expect(cp.connect(beneficiary).claimPayment(id))
        .to.be.revertedWithCustomError(cp, "AlreadyClaimed");
    });
  });

  // ── refundPayment ────────────────────────────────────────────────────────────
  describe("refundPayment()", () => {
    it("creator gets refund after expiry when not triggered", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();
      const MockMarketForCP = await ethers.getContractFactory("MockMarketForCP");
      // Resolved NO — payment was waiting for YES, so not triggered
      const mockMarket = await MockMarketForCP.deploy(
        MarketState.RESOLVED, Outcome.NO, ethers.ZeroAddress, ethers.ZeroAddress
      );
      await mockMarket.waitForDeployment();

      const expires = BigInt(await time.latest()) + 1n * DAY;
      const amount  = 500n * USDT_UNIT;
      const id = await createPayment(cp, usdt, creator, beneficiary, await mockMarket.getAddress(), {
        trigger: Outcome.YES, amount, expires
      });

      await time.increaseTo(expires + 1n);
      const before = await usdt.balanceOf(creator.address);
      await expect(cp.connect(creator).refundPayment(id))
        .to.emit(cp, "PaymentRefunded");
      expect(await usdt.balanceOf(creator.address)).to.be.gt(before);
    });

    it("reverts NotExpired before expiry", async () => {
      const { cp, usdt, creator, beneficiary } = await deployCP();
      const MockMarketForCP = await ethers.getContractFactory("MockMarketForCP");
      const mockMarket = await MockMarketForCP.deploy(
        MarketState.RESOLVED, Outcome.NO, ethers.ZeroAddress, ethers.ZeroAddress
      );
      await mockMarket.waitForDeployment();

      const id = await createPayment(cp, usdt, creator, beneficiary, await mockMarket.getAddress(), {
        trigger: Outcome.YES,
        expires: BigInt(await time.latest()) + 30n * DAY
      });
      await expect(cp.connect(creator).refundPayment(id))
        .to.be.revertedWithCustomError(cp, "NotExpired");
    });
  });
});

describe("ExecutionRouter", function () {
  let router, market, owner, alice;

  beforeEach(async () => {
    [owner, alice] = await ethers.getSigners();
    const ER = await ethers.getContractFactory("ExecutionRouter");
    router = await ER.deploy();
    await router.waitForDeployment();

    const MockTrade = await ethers.getContractFactory("MockTradeMarket");
    market = await MockTrade.deploy();
    await market.waitForDeployment();
  });

  it("tradeYes() calls buyYes on target market", async () => {
    await expect(router.connect(alice).tradeYes(await market.getAddress(), 100n))
      .to.emit(market, "BuyYesCalled")
      .withArgs(100n);
  });

  it("tradeNo() calls buyNo on target market", async () => {
    await expect(router.connect(alice).tradeNo(await market.getAddress(), 200n))
      .to.emit(market, "BuyNoCalled")
      .withArgs(200n);
  });
});