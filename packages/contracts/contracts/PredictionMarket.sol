// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./OutcomeToken.sol";

/**
 * @title PredictionMarket
 * @notice Binary prediction market denominated in USD₮ (USDT).
 *
 * Architecture:
 *   - Users buy YES or NO outcome tokens by depositing USDT
 *   - At resolution, winning side holders redeem their tokens 1:1 for USDT
 *     from the total pot (minus protocol fee)
 *   - The autonomous agent interacts via enterPosition() and redeem()
 *
 * @dev Uses a constant-product AMM for pricing:
 *      price_YES = noReserve / (yesReserve + noReserve)
 */
contract PredictionMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Outcome { UNRESOLVED, YES, NO }

    /// @notice Human-readable question this market resolves.
    string public question;

    /// @notice USDT token used for settlement.
    IERC20 public immutable usdt;

    /// @notice YES and NO outcome tokens.
    OutcomeToken public immutable yesToken;
    OutcomeToken public immutable noToken;

    /// @notice Resolved outcome (UNRESOLVED until resolution).
    Outcome public resolvedOutcome;

    /// @notice Timestamp after which no new positions can be entered.
    uint256 public immutable closingTime;

    /// @notice Protocol fee in basis points (default: 50 = 0.5%).
    uint256 public feeBps;

    /// @notice Accumulated protocol fees (claimable by owner).
    uint256 public accruedFees;

    /// @notice Total USDT deposited (both sides).
    uint256 public totalDeposited;

    /// @notice YES-side USDT reserves (for AMM pricing).
    uint256 public yesReserve;

    /// @notice NO-side USDT reserves (for AMM pricing).
    uint256 public noReserve;

    event PositionEntered(address indexed trader, bool isYes, uint256 usdtIn, uint256 tokensOut);
    event MarketResolved(Outcome outcome);
    event Redeemed(address indexed trader, uint256 tokensIn, uint256 usdtOut);
    event FeesClaimed(address indexed owner, uint256 amount);

    error MarketClosed();
    error MarketNotResolved();
    error MarketAlreadyResolved();
    error ZeroAmount();
    error InsufficientOutput(uint256 minOut, uint256 actualOut);

    constructor(
        string memory question_,
        address usdt_,
        uint256 closingTime_,
        uint256 initialYesUsdt,
        uint256 initialNoUsdt,
        uint256 feeBps_,
        address owner_
    ) Ownable(owner_) {
        question = question_;
        usdt = IERC20(usdt_);
        closingTime = closingTime_;
        feeBps = feeBps_;

        yesToken = new OutcomeToken(
            string.concat("YES: ", question_),
            "YES",
            "YES",
            address(this)
        );
        noToken = new OutcomeToken(
            string.concat("NO: ", question_),
            "NO",
            "NO",
            address(this)
        );

        if (initialYesUsdt > 0 || initialNoUsdt > 0) {
            uint256 seed = initialYesUsdt + initialNoUsdt;
            usdt.safeTransferFrom(owner_, address(this), seed);
            yesReserve = initialYesUsdt;
            noReserve = initialNoUsdt;
            totalDeposited += seed;
    
            yesToken.mint(owner_, initialYesUsdt);
            noToken.mint(owner_, initialNoUsdt);
        }
    }

    /**
     * @notice Enter a YES or NO position by depositing USDT.
     * @param isYes    True for YES position, false for NO.
     * @param usdtIn   Amount of USDT to stake (6 decimals).
     * @param minTokensOut Minimum outcome tokens to receive (slippage guard).
     * @return tokensOut Number of outcome tokens minted.
     */
    function enterPosition(
        bool isYes,
        uint256 usdtIn,
        uint256 minTokensOut
    ) external nonReentrant returns (uint256 tokensOut) {
        if (block.timestamp >= closingTime) revert MarketClosed();
        if (resolvedOutcome != Outcome.UNRESOLVED) revert MarketAlreadyResolved();
        if (usdtIn == 0) revert ZeroAmount();

        // Deduct protocol fee
        uint256 fee = (usdtIn * feeBps) / 10_000;
        uint256 netIn = usdtIn - fee;
        accruedFees += fee;

        // Transfer USDT in
        usdt.safeTransferFrom(msg.sender, address(this), usdtIn);
        totalDeposited += usdtIn;

        // AMM pricing: tokens out = netIn * oppositeReserve / (ownReserve + netIn)
        // Ensures price reflects current probability
        if (isYes) {
            tokensOut = (netIn * noReserve) / (yesReserve + netIn);
            yesReserve += netIn;
            yesToken.mint(msg.sender, tokensOut);
        } else {
            tokensOut = (netIn * yesReserve) / (noReserve + netIn);
            noReserve += netIn;
            noToken.mint(msg.sender, tokensOut);
        }

        if (tokensOut < minTokensOut) revert InsufficientOutput(minTokensOut, tokensOut);

        emit PositionEntered(msg.sender, isYes, usdtIn, tokensOut);
    }

    /**
     * @notice Redeem winning outcome tokens for USDT after market resolution.
     * @param amount Number of outcome tokens to burn.
     * @return usdtOut Amount of USDT received.
     */
    function redeem(uint256 amount) external nonReentrant returns (uint256 usdtOut) {
        if (resolvedOutcome == Outcome.UNRESOLVED) revert MarketNotResolved();
        if (amount == 0) revert ZeroAmount();

        OutcomeToken winningToken = resolvedOutcome == Outcome.YES ? yesToken : noToken;
        uint256 winningSupply = winningToken.totalSupply();

        // Pro-rata share of total pot (minus accrued fees)
        uint256 pot = totalDeposited - accruedFees;
        usdtOut = (amount * pot) / winningSupply;

        winningToken.burn(msg.sender, amount);
        usdt.safeTransfer(msg.sender, usdtOut);

        emit Redeemed(msg.sender, amount, usdtOut);
    }

    /**
     * @notice Resolve the market with its final outcome.
     * @dev In production, this is called by an oracle or a multisig.
     *      For the hackathon, the owner (deployer) resolves manually.
     */
    function resolve(bool yesWon) external onlyOwner {
        if (resolvedOutcome != Outcome.UNRESOLVED) revert MarketAlreadyResolved();
        resolvedOutcome = yesWon ? Outcome.YES : Outcome.NO;
        emit MarketResolved(resolvedOutcome);
    }

    /**
     * @notice Claim accumulated protocol fees.
     */
    function claimFees() external onlyOwner {
        uint256 fees = accruedFees;
        accruedFees = 0;
        usdt.safeTransfer(owner(), fees);
        emit FeesClaimed(owner(), fees);
    }

    /**
     * @notice Current implied probability of YES outcome (0–1e18 scale).
     */
    function impliedYesProbability() external view returns (uint256) {
        uint256 total = yesReserve + noReserve;
        if (total == 0) return 5e17; // 50% default
        return (noReserve * 1e18) / total;
    }

    /**
     * @notice Quote: how many outcome tokens for a given USDT input.
     */
    function quoteEnterPosition(bool isYes, uint256 usdtIn)
        external
        view
        returns (uint256 tokensOut)
    {
        uint256 fee = (usdtIn * feeBps) / 10_000;
        uint256 netIn = usdtIn - fee;
        if (isYes) {
            tokensOut = (netIn * noReserve) / (yesReserve + netIn);
        } else {
            tokensOut = (netIn * yesReserve) / (noReserve + netIn);
        }
    }
}
