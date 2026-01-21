import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { TokenVesting, VestingToken } from "../typechain-types";

describe("TokenVesting", function () {
  let vestingToken: VestingToken;
  let tokenVesting: TokenVesting;
  let owner: any;
  let beneficiary: any;
  let otherUser: any;

  const TOTAL_AMOUNT = ethers.parseEther("1000");
  const CLIFF_DURATION = 90 * 24 * 60 * 60; // 90 days
  const VESTING_DURATION = 365 * 24 * 60 * 60; // 365 days

  beforeEach(async function () {
    [owner, beneficiary, otherUser] = await ethers.getSigners();

    const VestingTokenFactory = await ethers.getContractFactory("VestingToken");
    vestingToken = await VestingTokenFactory.deploy("Vesting Token", "VEST", ethers.parseEther("1000000"));

    const TokenVestingFactory = await ethers.getContractFactory("TokenVesting");
    tokenVesting = await TokenVestingFactory.deploy(await vestingToken.getAddress());

    await vestingToken.approve(await tokenVesting.getAddress(), ethers.parseEther("1000000"));
  });

  describe("createVestingSchedule", function () {
    it("should create a vesting schedule", async function () {
      await expect(
        tokenVesting.createVestingSchedule(beneficiary.address, TOTAL_AMOUNT, CLIFF_DURATION, VESTING_DURATION, true),
      ).to.emit(tokenVesting, "VestingScheduleCreated");

      const schedule = await tokenVesting.getVestingSchedule(0);
      expect(schedule.beneficiary).to.equal(beneficiary.address);
      expect(schedule.totalAmount).to.equal(TOTAL_AMOUNT);
    });

    it("should revert with zero beneficiary", async function () {
      await expect(
        tokenVesting.createVestingSchedule(ethers.ZeroAddress, TOTAL_AMOUNT, CLIFF_DURATION, VESTING_DURATION, true),
      ).to.be.revertedWithCustomError(tokenVesting, "InvalidBeneficiary");
    });

    it("should revert with zero amount", async function () {
      await expect(
        tokenVesting.createVestingSchedule(beneficiary.address, 0, CLIFF_DURATION, VESTING_DURATION, true),
      ).to.be.revertedWithCustomError(tokenVesting, "InvalidAmount");
    });

    it("should revert with cliff exceeding duration", async function () {
      await expect(
        tokenVesting.createVestingSchedule(
          beneficiary.address,
          TOTAL_AMOUNT,
          VESTING_DURATION + 1,
          VESTING_DURATION,
          true,
        ),
      ).to.be.revertedWithCustomError(tokenVesting, "CliffExceedsDuration");
    });

    it("should allow multiple schedules for same beneficiary", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        false,
      );

      expect(await tokenVesting.getScheduleCount()).to.equal(2);
    });
  });

  describe("claim", function () {
    beforeEach(async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );
    });

    it("should not allow claiming before cliff", async function () {
      await expect(tokenVesting.connect(beneficiary).claim(0)).to.be.revertedWithCustomError(
        tokenVesting,
        "NothingToClaim",
      );
    });

    it("should allow claiming after cliff", async function () {
      await time.increase(CLIFF_DURATION + 1);

      await expect(tokenVesting.connect(beneficiary).claim(0)).to.emit(tokenVesting, "TokensClaimed");
    });

    it("should vest linearly after cliff", async function () {
      await time.increase(VESTING_DURATION / 2);

      const claimable = await tokenVesting.getClaimableAmount(0);
      const expected = TOTAL_AMOUNT / 2n;

      expect(claimable).to.be.closeTo(expected, expected / 100n);
    });

    it("should allow claiming exactly at cliff end", async function () {
      await time.increase(CLIFF_DURATION);

      const claimable = await tokenVesting.getClaimableAmount(0);
      const expectedAtCliff = (TOTAL_AMOUNT * BigInt(CLIFF_DURATION)) / BigInt(VESTING_DURATION);

      expect(claimable).to.be.closeTo(expectedAtCliff, expectedAtCliff / 100n);
    });

    it("should allow multiple claims", async function () {
      // First claim at 25%
      await time.increase(VESTING_DURATION / 4);
      await tokenVesting.connect(beneficiary).claim(0);

      const balanceAfterFirst = await vestingToken.balanceOf(beneficiary.address);

      // Second claim at 50%
      await time.increase(VESTING_DURATION / 4);
      await tokenVesting.connect(beneficiary).claim(0);

      const balanceAfterSecond = await vestingToken.balanceOf(beneficiary.address);
      expect(balanceAfterSecond).to.be.gt(balanceAfterFirst);

      // Third claim at 100%
      await time.increase(VESTING_DURATION / 2);
      await tokenVesting.connect(beneficiary).claim(0);

      const finalBalance = await vestingToken.balanceOf(beneficiary.address);
      expect(finalBalance).to.equal(TOTAL_AMOUNT);
    });

    it("should not allow non-beneficiary to claim", async function () {
      await time.increase(CLIFF_DURATION + 1);

      await expect(tokenVesting.connect(otherUser).claim(0)).to.be.revertedWithCustomError(
        tokenVesting,
        "NotBeneficiary",
      );
    });

    it("should not allow claiming when paused", async function () {
      await time.increase(CLIFF_DURATION + 1);
      await tokenVesting.pause();

      await expect(tokenVesting.connect(beneficiary).claim(0)).to.be.revertedWithCustomError(
        tokenVesting,
        "EnforcedPause",
      );
    });
  });

  describe("revokeVesting", function () {
    it("should revoke and return unvested tokens", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );

      const ownerBalanceBefore = await vestingToken.balanceOf(owner.address);

      await expect(tokenVesting.revokeVesting(0)).to.emit(tokenVesting, "VestingRevoked");

      const ownerBalanceAfter = await vestingToken.balanceOf(owner.address);
      expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + TOTAL_AMOUNT);
    });

    it("should not allow revoking non-revocable schedules", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        false,
      );

      await expect(tokenVesting.revokeVesting(0)).to.be.revertedWithCustomError(tokenVesting, "NotRevocable");
    });

    it("should not allow double revocation", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );

      await tokenVesting.revokeVesting(0);

      await expect(tokenVesting.revokeVesting(0)).to.be.revertedWithCustomError(tokenVesting, "AlreadyRevoked");
    });

    it("should not allow revoking fully vested schedule", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );

      await time.increase(VESTING_DURATION + 1);

      await expect(tokenVesting.revokeVesting(0)).to.be.revertedWithCustomError(tokenVesting, "NothingToRevoke");
    });

    it("should allow beneficiary to claim vested portion after revocation", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );

      // Move to 50% vested
      await time.increase(VESTING_DURATION / 2);

      // Beneficiary claims some
      await tokenVesting.connect(beneficiary).claim(0);

      // Admin revokes
      await tokenVesting.revokeVesting(0);

      // Beneficiary claims remaining vested portion
      const claimableAfterRevoke = await tokenVesting.getClaimableAmount(0);
      if (claimableAfterRevoke > 0n) {
        await tokenVesting.connect(beneficiary).claim(0);
      }

      // Verify beneficiary got roughly half the tokens
      const finalBalance = await vestingToken.balanceOf(beneficiary.address);
      expect(finalBalance).to.be.closeTo(TOTAL_AMOUNT / 2n, TOTAL_AMOUNT / 100n);
    });

    it("should allow revoking when contract is paused", async function () {
      await tokenVesting.createVestingSchedule(
        beneficiary.address,
        TOTAL_AMOUNT,
        CLIFF_DURATION,
        VESTING_DURATION,
        true,
      );

      await tokenVesting.pause();

      // Should still be able to revoke during emergency
      await expect(tokenVesting.revokeVesting(0)).to.emit(tokenVesting, "VestingRevoked");
    });
  });

  describe("pause/unpause", function () {
    it("should pause and unpause", async function () {
      await tokenVesting.pause();
      expect(await tokenVesting.paused()).to.equal(true);

      await tokenVesting.unpause();
      expect(await tokenVesting.paused()).to.equal(false);
    });

    it("should not allow non-owner to pause", async function () {
      await expect(tokenVesting.connect(beneficiary).pause()).to.be.revertedWithCustomError(
        tokenVesting,
        "OwnableUnauthorizedAccount",
      );
    });

    it("should not allow creating schedules when paused", async function () {
      await tokenVesting.pause();

      await expect(
        tokenVesting.createVestingSchedule(beneficiary.address, TOTAL_AMOUNT, CLIFF_DURATION, VESTING_DURATION, true),
      ).to.be.revertedWithCustomError(tokenVesting, "EnforcedPause");
    });
  });
});
