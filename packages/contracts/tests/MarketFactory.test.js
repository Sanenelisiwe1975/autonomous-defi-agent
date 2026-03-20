// test/MarketFactory.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const { USDT_UNIT, DAY, DEFAULT_FEE_BPS } = require("./helpers");

async function deploy(permissionless = true) {
  const [owner, alice, bob] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdt = await MockERC20.deploy("Mock USDT", "USDT", 6);
  await usdt.waitForDeployment();
  await usdt.mint(alice.address, 100_000n * USDT_UNIT);
  await usdt.mint(bob.address,   100_000n * USDT_UNIT);

  const Factory = await ethers.getContractFactory("MarketFactory");
  const factory = await Factory.deploy(
    await usdt.getAddress(),
    DEFAULT_FEE_BPS,
    permissionless,
    owner.address
  );
  await factory.waitForDeployment();

  return { factory, usdt, owner, alice, bob };
}

async function futureClosing() {
  const now = BigInt(await time.latest());
  return now + 7n * DAY;
}

describe("MarketFactory", function () {
    
  describe("Deployment", () => {
    it("stores usdt, feeBps, permissionless, owner", async () => {
      const { factory, usdt, owner } = await deploy();
      expect(await factory.usdt()).to.equal(await usdt.getAddress());
      expect(await factory.defaultFeeBps()).to.equal(DEFAULT_FEE_BPS);
      expect(await factory.permissionless()).to.equal(true);
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("starts with zero markets", async () => {
      const { factory } = await deploy();
      expect(await factory.marketCount()).to.equal(0n);
    });
  });

  describe("createMarket()", () => {
    it("deploys a market and registers it", async () => {
      const { factory, usdt, alice } = await deploy();
      const closing = await futureClosing();
      const seed = 500n * USDT_UNIT;
      await usdt.connect(alice).approve(await factory.getAddress(), seed * 2n);

      await expect(
        factory.connect(alice).createMarket("Q?", closing, seed, seed)
      ).to.emit(factory, "MarketCreated");

      expect(await factory.marketCount()).to.equal(1n);
    });

    it("marks market as active", async () => {
      const { factory, usdt, alice } = await deploy();
      const closing = await futureClosing();
      await usdt.connect(alice).approve(await factory.getAddress(), ethers.MaxUint256);

      await factory.connect(alice).createMarket("Q?", closing, 0n, 0n);
      const addr = await factory.markets(0);
      expect(await factory.isActive(addr)).to.equal(true);
    });

    it("transfers seed USDT to the market", async () => {
      const { factory, usdt, alice } = await deploy();
      const closing = await futureClosing();
      const seed = 1_000n * USDT_UNIT;
      await usdt.connect(alice).approve(await factory.getAddress(), seed * 2n);

      await factory.connect(alice).createMarket("Q?", closing, seed, seed);
      const marketAddr = await factory.markets(0);
      expect(await usdt.balanceOf(marketAddr)).to.be.gte(seed * 2n);
    });

    it("returns the new market address", async () => {
      const { factory, usdt, alice } = await deploy();
      const closing = await futureClosing();
      await usdt.connect(alice).approve(await factory.getAddress(), ethers.MaxUint256);

      const tx = await factory.connect(alice).createMarket("Q?", closing, 0n, 0n);
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment?.name === "MarketCreated");
      expect(event).to.not.be.undefined;
      expect(event.args.market).to.not.equal(ethers.ZeroAddress);
    });

    it("reverts when closingTime is in the past", async () => {
      const { factory, alice } = await deploy();
      const now = BigInt(await time.latest());
      await expect(
        factory.connect(alice).createMarket("Q?", now - 1n, 0n, 0n)
      ).to.be.revertedWith("MarketFactory: closing in past");
    });

    it("reverts for unauthorized caller when NOT permissionless", async () => {
      const { factory, alice } = await deploy(false); // permissionless = false
      const closing = await futureClosing();
      await expect(
        factory.connect(alice).createMarket("Q?", closing, 0n, 0n)
      ).to.be.revertedWith("MarketFactory: not authorised");
    });

    it("owner can create market even when not permissionless", async () => {
      const { factory, owner } = await deploy(false);
      const closing = await futureClosing();
      await expect(
        factory.connect(owner).createMarket("Q?", closing, 0n, 0n)
      ).not.to.be.reverted;
    });

    it("deploys multiple markets and tracks all", async () => {
      const { factory, alice } = await deploy();
      const closing = await futureClosing();

      await factory.connect(alice).createMarket("Q1?", closing, 0n, 0n);
      await factory.connect(alice).createMarket("Q2?", closing, 0n, 0n);
      await factory.connect(alice).createMarket("Q3?", closing, 0n, 0n);

      expect(await factory.marketCount()).to.equal(3n);
    });
  });

  describe("getActiveMarkets()", () => {
    it("returns all active markets initially", async () => {
      const { factory, alice } = await deploy();
      const closing = await futureClosing();

      await factory.connect(alice).createMarket("Q1?", closing, 0n, 0n);
      await factory.connect(alice).createMarket("Q2?", closing, 0n, 0n);

      const active = await factory.getActiveMarkets();
      expect(active.length).to.equal(2);
    });

    it("excludes deactivated markets", async () => {
      const { factory, owner, alice } = await deploy();
      const closing = await futureClosing();

      await factory.connect(alice).createMarket("Q1?", closing, 0n, 0n);
      await factory.connect(alice).createMarket("Q2?", closing, 0n, 0n);

      const m1 = await factory.markets(0);
      await factory.connect(owner).deactivateMarket(m1);

      const active = await factory.getActiveMarkets();
      expect(active.length).to.equal(1);
      expect(active[0]).to.not.equal(m1);
    });

    it("returns empty array when all deactivated", async () => {
      const { factory, owner, alice } = await deploy();
      const closing = await futureClosing();
      await factory.connect(alice).createMarket("Q?", closing, 0n, 0n);
      const m = await factory.markets(0);
      await factory.connect(owner).deactivateMarket(m);
      expect((await factory.getActiveMarkets()).length).to.equal(0);
    });
  });

  describe("deactivateMarket()", () => {
    it("owner deactivates a market", async () => {
      const { factory, owner, alice } = await deploy();
      const closing = await futureClosing();
      await factory.connect(alice).createMarket("Q?", closing, 0n, 0n);
      const m = await factory.markets(0);

      await expect(factory.connect(owner).deactivateMarket(m))
        .to.emit(factory, "MarketDeactivated")
        .withArgs(m);

      expect(await factory.isActive(m)).to.equal(false);
    });

    it("reverts for non-owner", async () => {
      const { factory, alice } = await deploy();
      const closing = await futureClosing();
      await factory.connect(alice).createMarket("Q?", closing, 0n, 0n);
      const m = await factory.markets(0);

      await expect(factory.connect(alice).deactivateMarket(m))
        .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });
  });

  describe("Admin setters", () => {
    it("owner updates defaultFeeBps", async () => {
      const { factory, owner } = await deploy();
      await factory.connect(owner).setDefaultFeeBps(200n);
      expect(await factory.defaultFeeBps()).to.equal(200n);
    });

    it("owner toggles permissionless", async () => {
      const { factory, owner } = await deploy();
      await factory.connect(owner).setPermissionless(false);
      expect(await factory.permissionless()).to.equal(false);
    });

    it("non-owner cannot call admin setters", async () => {
      const { factory, alice } = await deploy();
      await expect(factory.connect(alice).setDefaultFeeBps(200n))
        .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
      await expect(factory.connect(alice).setPermissionless(false))
        .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });
  });
});