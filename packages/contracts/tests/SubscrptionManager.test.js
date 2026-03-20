// test/SubscriptionManager.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const { USDT_UNIT, DAY } = require("./helpers");

const PLAN = { FREE: 0n, BASIC: 1n, PRO: 2n, INSTITUTIONAL: 3n };
const BASIC_PRICE = 29n * USDT_UNIT;
const PRO_PRICE   = 99n * USDT_UNIT;
const PERIOD      = 30n * DAY;

async function deploy() {
  const [owner, treasury, alice, bob, carol] = await ethers.getSigners();
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdt = await MockERC20.deploy("Mock USDT", "USDT", 6);
  await usdt.waitForDeployment();

  await usdt.mint(alice.address, 10_000n * USDT_UNIT);
  await usdt.mint(bob.address,   10_000n * USDT_UNIT);
  await usdt.mint(carol.address, 10_000n * USDT_UNIT);

  const SM = await ethers.getContractFactory("SubscriptionManager");
  const sm = await SM.deploy(owner.address, treasury.address, await usdt.getAddress());
  await sm.waitForDeployment();

  const smAddr = await sm.getAddress();
  await usdt.connect(alice).approve(smAddr, ethers.MaxUint256);
  await usdt.connect(bob).approve(smAddr,   ethers.MaxUint256);
  await usdt.connect(carol).approve(smAddr, ethers.MaxUint256);

  return { sm, usdt, owner, treasury, alice, bob, carol };
}

describe("SubscriptionManager", function () {

  describe("Deployment", () => {
    it("sets owner, treasury, collateralToken", async () => {
      const { sm, usdt, owner, treasury } = await deploy();
      expect(await sm.owner()).to.equal(owner.address);
      expect(await sm.treasury()).to.equal(treasury.address);
      expect(await sm.collateralToken()).to.equal(await usdt.getAddress());
    });

    it("initialises default plan configs", async () => {
      const { sm } = await deploy();
      const basic = await sm.plans(PLAN.BASIC);
      expect(basic.pricePerPeriod).to.equal(BASIC_PRICE);
      expect(basic.period).to.equal(PERIOD);
      expect(basic.active).to.equal(true);
    });
  });

  describe("subscribe()", () => {
    it("FREE plan — no payment required, sets paidUntil", async () => {
      const { sm, alice } = await deploy();
      await expect(sm.connect(alice).subscribe(PLAN.FREE))
        .to.emit(sm, "Subscribed")
        .withArgs(alice.address, PLAN.FREE, await sm.subscriptions(alice.address).then(r => r.paidUntil));

      const sub = await sm.getSubscriptionRecord(alice.address);
      expect(sub.plan).to.equal(PLAN.FREE);
      expect(sub.cancelled).to.equal(false);
    });

    it("BASIC plan — charges correct amount to treasury", async () => {
      const { sm, usdt, alice, treasury } = await deploy();
      const before = await usdt.balanceOf(treasury.address);
      await sm.connect(alice).subscribe(PLAN.BASIC);
      expect(await usdt.balanceOf(treasury.address)).to.equal(before + BASIC_PRICE);
    });

    it("PRO plan — records totalPaid", async () => {
      const { sm, alice } = await deploy();
      await sm.connect(alice).subscribe(PLAN.PRO);
      const sub = await sm.getSubscriptionRecord(alice.address);
      expect(sub.totalPaid).to.equal(PRO_PRICE);
    });

    it("increments activeSubscribers", async () => {
      const { sm, alice, bob } = await deploy();
      await sm.connect(alice).subscribe(PLAN.FREE);
      await sm.connect(bob).subscribe(PLAN.BASIC);
      expect(await sm.activeSubscribers()).to.equal(2n);
    });

    it("reverts AlreadySubscribed if subscription still active", async () => {
      const { sm, alice } = await deploy();
      await sm.connect(alice).subscribe(PLAN.FREE);
      await expect(sm.connect(alice).subscribe(PLAN.FREE))
        .to.be.revertedWithCustomError(sm, "AlreadySubscribed");
    });

    it("reverts PlanNotActive for disabled plan", async () => {
      const { sm, owner, alice } = await deploy();
      await sm.connect(owner).configurePlan(PLAN.BASIC, BASIC_PRICE, PERIOD, 3n * DAY, false);
      await expect(sm.connect(alice).subscribe(PLAN.BASIC))
        .to.be.revertedWithCustomError(sm, "PlanNotActive");
    });
  });

  describe("renew()", () => {
    it("extends paidUntil by one period (from current paidUntil)", async () => {
      const { sm, alice } = await deploy();
      await sm.connect(alice).subscribe(PLAN.BASIC);
      const subBefore = await sm.getSubscriptionRecord(alice.address);
      await sm.connect(alice).renew(alice.address);
      const subAfter = await sm.getSubscriptionRecord(alice.address);
      expect(subAfter.paidUntil).to.equal(subBefore.paidUntil + PERIOD);
    });

    it("extends from now if paidUntil has already passed", async () => {
      const { sm, alice } = await deploy();
      await sm.connect(alice).subscribe(PLAN.BASIC);
      await time.increase(PERIOD + 1n);
      const now = BigInt(await time.latest());
      await sm.connect(alice).renew(alice.address);
      const sub = await sm.getSubscriptionRecord(alice.address);
      expect(sub.paidUntil).to.be.gte(now + PERIOD - 2n);
    });

    it("charges renewal price to treasury", async () => {
      const { sm, usdt, alice, treasury } = await deploy();
      await sm.connect(alice).subscribe(PLAN.BASIC);
      const before = await usdt.balanceOf(treasury.address);
      await sm.connect(alice).renew(alice.address);
      expect(await usdt.balanceOf(treasury.address)).to.equal(before + BASIC_PRICE);
    });

    it("reverts NotSubscribed for unknown address", async () => {
      const { sm, bob } = await deploy();
      await expect(sm.connect(bob).renew(bob.address))
        .to.be.revertedWithCustomError(sm, "NotSubscribed");
    });

    it("reverts AlreadyCancelled after cancel", async () => {
      const { sm, alice } = await deploy();
      await sm.connect(alice).subscribe(PLAN.BASIC);
      await sm.connect(alice).cancel();
      await expect(sm.connect(alice).renew(alice.address))
        .to.be.revertedWithCustomError(sm, "AlreadyCancelled");
    });
  });

  describe("cancel()", () => {
    it("cancels subscription and emits event", async () => {
      const { sm, alice } = await deploy();
      await sm.connect(alice).subscribe(PLAN.BASIC);
      await expect(sm.connect(alice).cancel())
        .to.emit(sm, "Cancelled")
        .withArgs(alice.address, PLAN.BASIC);
      const sub = await sm.getSubscriptionRecord(alice.address);
      expect(sub.cancelled).to.equal(true);
    });

    it("decrements activeSubscribers", async () => {
      const { sm, alice } = await deploy();
      await sm.connect(alice).subscribe(PLAN.FREE);
      expect(await sm.activeSubscribers()).to.equal(1n);
      await sm.connect(alice).cancel();
      expect(await sm.activeSubscribers()).to.equal(0n);
    });

    it("reverts NotSubscribed for unknown user", async () => {
      const { sm, alice } = await deploy();
      await expect(sm.connect(alice).cancel())
        .to.be.revertedWithCustomError(sm, "NotSubscribed");
    });

    it("reverts AlreadyCancelled on double-cancel", async () => {
      const { sm, alice } = await deploy();
      await sm.connect(alice).subscribe(PLAN.FREE);
      await sm.connect(alice).cancel();
      await expect(sm.connect(alice).cancel())
        .to.be.revertedWithCustomError(sm, "AlreadyCancelled");
    });
  });

  describe("isActive()", () => {
    it("returns true while paidUntil has not passed", async () => {
      const { sm, alice } = await deploy();
      await sm.connect(alice).subscribe(PLAN.BASIC);
      expect(await sm.isActive(alice.address)).to.equal(true);
    });

    it("returns true during grace period", async () => {
      const { sm, alice } = await deploy();
      await sm.connect(alice).subscribe(PLAN.BASIC);
      await time.increase(PERIOD + 1n);         // past paidUntil
      expect(await sm.isActive(alice.address)).to.equal(true); // still in grace (3 days)
    });

    it("returns false after grace period", async () => {
      const { sm, alice } = await deploy();
      await sm.connect(alice).subscribe(PLAN.BASIC);
      await time.increase(PERIOD + 3n * DAY + 1n); // past paidUntil + grace
      expect(await sm.isActive(alice.address)).to.equal(false);
    });

    it("returns false after cancellation", async () => {
      const { sm, alice } = await deploy();
      await sm.connect(alice).subscribe(PLAN.FREE);
      await sm.connect(alice).cancel();
      expect(await sm.isActive(alice.address)).to.equal(false);
    });

    it("returns false for unsubscribed user", async () => {
      const { sm, alice } = await deploy();
      expect(await sm.isActive(alice.address)).to.equal(false);
    });
  });

  describe("configurePlan()", () => {
    it("owner can configure a plan", async () => {
      const { sm, owner } = await deploy();
      await expect(sm.connect(owner).configurePlan(PLAN.PRO, 150n * USDT_UNIT, 30n * DAY, 5n * DAY, true))
        .to.emit(sm, "PlanConfigured");
      const plan = await sm.plans(PLAN.PRO);
      expect(plan.pricePerPeriod).to.equal(150n * USDT_UNIT);
    });

    it("reverts for non-owner", async () => {
      const { sm, alice } = await deploy();
      await expect(sm.connect(alice).configurePlan(PLAN.PRO, 0n, 30n * DAY, 0n, true))
        .to.be.revertedWithCustomError(sm, "Unauthorized");
    });
  });

  describe("setTreasury()", () => {
    it("owner updates treasury", async () => {
      const { sm, owner, alice } = await deploy();
      await sm.connect(owner).setTreasury(alice.address);
      expect(await sm.treasury()).to.equal(alice.address);
    });

    it("reverts ZeroAddress", async () => {
      const { sm, owner } = await deploy();
      await expect(sm.connect(owner).setTreasury(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(sm, "ZeroAddress");
    });
  });
});