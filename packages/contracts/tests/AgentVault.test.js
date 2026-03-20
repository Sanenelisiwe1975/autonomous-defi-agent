// test/AgentVault.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");
const { USDT_UNIT, DAY, DAILY_LIMIT } = require("./helpers");

async function deploy(overrides = {}) {
  const [owner, agent, alice, bob] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdt = await MockERC20.deploy("Mock USDT", "USDT", 6);
  const xaut = await MockERC20.deploy("Mock XAUT", "XAUT", 6);
  await usdt.waitForDeployment();
  await xaut.waitForDeployment();

  const Vault = await ethers.getContractFactory("AgentVault");
  const vault = await Vault.deploy(
    await usdt.getAddress(),
    await xaut.getAddress(),
    overrides.agentAddr ?? agent.address,
    overrides.dailyLimit ?? DAILY_LIMIT,
    owner.address
  );
  await vault.waitForDeployment();

  // Fund vault
  await usdt.mint(await vault.getAddress(), 50_000n * USDT_UNIT);
  await xaut.mint(await vault.getAddress(), 10n * USDT_UNIT);

  return { vault, usdt, xaut, owner, agent, alice, bob };
}

describe("AgentVault", function () {

  describe("Deployment", () => {
    it("stores usdt, xaut, agent, dailyLimit, owner", async () => {
      const { vault, usdt, xaut, owner, agent } = await deploy();
      expect(await vault.usdt()).to.equal(await usdt.getAddress());
      expect(await vault.xaut()).to.equal(await xaut.getAddress());
      expect(await vault.agent()).to.equal(agent.address);
      expect(await vault.dailyLimitUsdt()).to.equal(DAILY_LIMIT);
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("reverts on zero addresses in constructor", async () => {
      const [owner, agent] = await ethers.getSigners();
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const tok = await MockERC20.deploy("T","T",6);
      await tok.waitForDeployment();
      const addr = await tok.getAddress();
      const Vault = await ethers.getContractFactory("AgentVault");

      await expect(Vault.deploy(ethers.ZeroAddress, addr, agent.address, DAILY_LIMIT, owner.address))
        .to.be.revertedWithCustomError(await ethers.getContractFactory("AgentVault"), "ZeroAddress");
      await expect(Vault.deploy(addr, ethers.ZeroAddress, agent.address, DAILY_LIMIT, owner.address))
        .to.be.revertedWithCustomError(await ethers.getContractFactory("AgentVault"), "ZeroAddress");
      await expect(Vault.deploy(addr, addr, ethers.ZeroAddress, DAILY_LIMIT, owner.address))
        .to.be.revertedWithCustomError(await ethers.getContractFactory("AgentVault"), "ZeroAddress");
    });
  });

  describe("agentWithdrawUsdt()", () => {
    it("agent can withdraw within daily limit", async () => {
      const { vault, usdt, agent, alice } = await deploy();
      const amount = 1_000n * USDT_UNIT;
      const before = await usdt.balanceOf(alice.address);
      await expect(vault.connect(agent).agentWithdrawUsdt(amount, alice.address))
        .to.emit(vault, "AgentWithdraw");
      expect(await usdt.balanceOf(alice.address)).to.equal(before + amount);
    });

    it("tracks withdrawnToday", async () => {
      const { vault, agent, alice } = await deploy();
      await vault.connect(agent).agentWithdrawUsdt(1_000n * USDT_UNIT, alice.address);
      expect(await vault.withdrawnToday()).to.equal(1_000n * USDT_UNIT);
    });

    it("reverts when daily limit exceeded", async () => {
      const { vault, agent, alice } = await deploy();
      // Withdraw full daily limit first
      await vault.connect(agent).agentWithdrawUsdt(DAILY_LIMIT, alice.address);
      // Next withdrawal should fail
      await expect(
        vault.connect(agent).agentWithdrawUsdt(1n, alice.address)
      ).to.be.revertedWithCustomError(vault, "DailyLimitExceeded");
    });

    it("resets limit after 24 hours", async () => {
      const { vault, agent, alice } = await deploy();
      await vault.connect(agent).agentWithdrawUsdt(DAILY_LIMIT, alice.address);
      await time.increase(DAY + 1n);
      // Should succeed again after window reset
      await expect(
        vault.connect(agent).agentWithdrawUsdt(1_000n * USDT_UNIT, alice.address)
      ).not.to.be.reverted;
    });

    it("reverts with ZeroAmount", async () => {
      const { vault, agent, alice } = await deploy();
      await expect(vault.connect(agent).agentWithdrawUsdt(0n, alice.address))
        .to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("reverts for non-agent caller", async () => {
      const { vault, alice } = await deploy();
      await expect(vault.connect(alice).agentWithdrawUsdt(100n, alice.address))
        .to.be.revertedWithCustomError(vault, "OnlyAgent");
    });
  });

  describe("agentWithdrawXaut()", () => {
    it("agent can withdraw XAUT (no daily limit)", async () => {
      const { vault, xaut, agent, alice } = await deploy();
      const amount = 5n * USDT_UNIT; // 5 XAUT
      await vault.connect(agent).agentWithdrawXaut(amount, alice.address);
      expect(await xaut.balanceOf(alice.address)).to.equal(amount);
    });

    it("emits AgentWithdraw event", async () => {
      const { vault, xaut, agent, alice } = await deploy();
      await expect(vault.connect(agent).agentWithdrawXaut(1n * USDT_UNIT, alice.address))
        .to.emit(vault, "AgentWithdraw")
        .withArgs(await xaut.getAddress(), 1n * USDT_UNIT, alice.address);
    });

    it("reverts with ZeroAmount", async () => {
      const { vault, agent, alice } = await deploy();
      await expect(vault.connect(agent).agentWithdrawXaut(0n, alice.address))
        .to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("reverts for non-agent", async () => {
      const { vault, alice } = await deploy();
      await expect(vault.connect(alice).agentWithdrawXaut(1n, alice.address))
        .to.be.revertedWithCustomError(vault, "OnlyAgent");
    });
  });

  describe("ownerWithdraw()", () => {
    it("owner can emergency-withdraw USDT", async () => {
      const { vault, usdt, owner, alice } = await deploy();
      const amount = 1_000n * USDT_UNIT;
      const before = await usdt.balanceOf(alice.address);
      await expect(vault.connect(owner).ownerWithdraw(await usdt.getAddress(), amount, alice.address))
        .to.emit(vault, "OwnerWithdraw")
        .withArgs(await usdt.getAddress(), amount, alice.address);
      expect(await usdt.balanceOf(alice.address)).to.equal(before + amount);
    });

    it("reverts for non-owner", async () => {
      const { vault, usdt, alice } = await deploy();
      await expect(
        vault.connect(alice).ownerWithdraw(await usdt.getAddress(), 100n, alice.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("setAgent()", () => {
    it("owner updates agent address", async () => {
      const { vault, owner, alice } = await deploy();
      await expect(vault.connect(owner).setAgent(alice.address))
        .to.emit(vault, "AgentUpdated");
      expect(await vault.agent()).to.equal(alice.address);
    });

    it("reverts with ZeroAddress", async () => {
      const { vault, owner } = await deploy();
      await expect(vault.connect(owner).setAgent(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("reverts for non-owner", async () => {
      const { vault, alice, bob } = await deploy();
      await expect(vault.connect(alice).setAgent(bob.address))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("setDailyLimit()", () => {
    it("owner updates daily limit", async () => {
      const { vault, owner } = await deploy();
      const newLimit = 10_000n * USDT_UNIT;
      await expect(vault.connect(owner).setDailyLimit(newLimit))
        .to.emit(vault, "DailyLimitUpdated")
        .withArgs(DAILY_LIMIT, newLimit);
      expect(await vault.dailyLimitUsdt()).to.equal(newLimit);
    });

    it("reverts for non-owner", async () => {
      const { vault, alice } = await deploy();
      await expect(vault.connect(alice).setDailyLimit(1n))
        .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("View helpers", () => {
    it("usdtBalance() returns vault USDT balance", async () => {
      const { vault, usdt } = await deploy();
      expect(await vault.usdtBalance()).to.equal(await usdt.balanceOf(await vault.getAddress()));
    });

    it("xautBalance() returns vault XAUT balance", async () => {
      const { vault, xaut } = await deploy();
      expect(await vault.xautBalance()).to.equal(await xaut.balanceOf(await vault.getAddress()));
    });

    it("remainingDailyUsdt() reflects spent amount", async () => {
      const { vault, agent, alice } = await deploy();
      const spent = 1_000n * USDT_UNIT;
      await vault.connect(agent).agentWithdrawUsdt(spent, alice.address);
      expect(await vault.remainingDailyUsdt()).to.equal(DAILY_LIMIT - spent);
    });

    it("remainingDailyUsdt() returns full limit after window reset", async () => {
      const { vault, agent, alice } = await deploy();
      await vault.connect(agent).agentWithdrawUsdt(DAILY_LIMIT, alice.address);
      await time.increase(DAY + 1n);
      expect(await vault.remainingDailyUsdt()).to.equal(DAILY_LIMIT);
    });
  });

  describe("receive()", () => {
    it("accepts ETH deposits and emits Deposited event", async () => {
      const { vault, alice } = await deploy();
      await expect(
        alice.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther("0.1") })
      ).to.emit(vault, "Deposited");
    });
  });
});