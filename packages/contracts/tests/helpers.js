// test/OutcomeToken.test.js
const { expect }  = require("chai");
const { ethers }  = require("hardhat");

describe("OutcomeToken", function () {
  let token, owner, alice, bob;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    const OT = await ethers.getContractFactory("OutcomeToken");
    // owner acts as the "market" (only minter/burner)
    token = await OT.deploy("YES: Will ETH flip BTC?", "YES", "YES", owner.address);
    await token.waitForDeployment();
  });

  describe("Deployment", () => {
    it("sets name, symbol and outcomeLabel", async () => {
      expect(await token.name()).to.equal("YES: Will ETH flip BTC?");
      expect(await token.symbol()).to.equal("YES");
      expect(await token.outcomeLabel()).to.equal("YES");
    });

    it("sets the market (owner) correctly", async () => {
      expect(await token.owner()).to.equal(owner.address);
    });

    it("starts with zero supply", async () => {
      expect(await token.totalSupply()).to.equal(0n);
    });
  });

  describe("mint()", () => {
    it("owner (market) can mint tokens", async () => {
      await token.connect(owner).mint(alice.address, 1_000n);
      expect(await token.balanceOf(alice.address)).to.equal(1_000n);
      expect(await token.totalSupply()).to.equal(1_000n);
    });

    it("emits Transfer event on mint", async () => {
      await expect(token.connect(owner).mint(alice.address, 500n))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, alice.address, 500n);
    });

    it("reverts when non-owner tries to mint", async () => {
      await expect(token.connect(alice).mint(alice.address, 100n))
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  describe("burn()", () => {
    beforeEach(async () => {
      await token.connect(owner).mint(alice.address, 2_000n);
    });

    it("owner (market) can burn tokens", async () => {
      await token.connect(owner).burn(alice.address, 500n);
      expect(await token.balanceOf(alice.address)).to.equal(1_500n);
      expect(await token.totalSupply()).to.equal(1_500n);
    });

    it("emits Transfer event on burn", async () => {
      await expect(token.connect(owner).burn(alice.address, 200n))
        .to.emit(token, "Transfer")
        .withArgs(alice.address, ethers.ZeroAddress, 200n);
    });

    it("reverts when non-owner tries to burn", async () => {
      await expect(token.connect(alice).burn(alice.address, 100n))
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("reverts when burning more than balance", async () => {
      await expect(token.connect(owner).burn(alice.address, 3_000n))
        .to.be.reverted;
    });
  });

  describe("ERC-20 transfers", () => {
    beforeEach(async () => {
      await token.connect(owner).mint(alice.address, 1_000n);
    });

    it("holder can transfer to another address", async () => {
      await token.connect(alice).transfer(bob.address, 300n);
      expect(await token.balanceOf(alice.address)).to.equal(700n);
      expect(await token.balanceOf(bob.address)).to.equal(300n);
    });

    it("approve and transferFrom flow works", async () => {
      await token.connect(alice).approve(bob.address, 400n);
      await token.connect(bob).transferFrom(alice.address, bob.address, 400n);
      expect(await token.balanceOf(bob.address)).to.equal(400n);
    });

    it("transferFrom reverts without allowance", async () => {
      await expect(
        token.connect(bob).transferFrom(alice.address, bob.address, 1n)
      ).to.be.reverted;
    });
  });
});