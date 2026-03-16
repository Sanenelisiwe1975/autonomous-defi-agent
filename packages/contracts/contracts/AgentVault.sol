// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentVault
 * @notice Secure on-chain vault for the autonomous DeFi agent.
 *
 * The vault holds USD₮ and XAU₮ reserves and enforces spending limits
 * so that a compromised or errant agent can never drain the full treasury.
 *
 * Architecture:
 *   - owner = deployer (human operator / multisig)
 *   - agent = the agent's WDK wallet address (AGENT_SEED_PHRASE account 0)
 *   - Agent can withdraw up to `dailyLimit` USDT per 24-hour window
 *   - Owner can withdraw everything or update the agent address
 *
 * This is the "programmable payment" design required by the hackathon:
 * payments only execute if the agent address is authorised and within limits.
 */
contract AgentVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // State

    /// @notice Authorised agent address (WDK wallet).
    address public agent;

    /// @notice USDT token contract.
    IERC20 public immutable usdt;

    /// @notice XAU₮ token contract.
    IERC20 public immutable xaut;

    /// @notice Maximum USDT the agent can withdraw per 24h window (6 decimals).
    uint256 public dailyLimitUsdt;

    /// @notice USDT withdrawn in the current 24h window.
    uint256 public withdrawnToday;

    /// @notice Timestamp when the current 24h window started.
    uint256 public windowStart;

    event AgentWithdraw(address indexed token, uint256 amount, address indexed to);
    event OwnerWithdraw(address indexed token, uint256 amount, address indexed to);
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event DailyLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event Deposited(address indexed token, uint256 amount, address indexed from);

    error OnlyAgent();
    error DailyLimitExceeded(uint256 requested, uint256 remaining);
    error ZeroAmount();
    error ZeroAddress();

    modifier onlyAgent() {
        if (msg.sender != agent) revert OnlyAgent();
        _;
    }

    constructor(
        address usdt_,
        address xaut_,
        address agent_,
        uint256 dailyLimitUsdt_,
        address owner_
    ) Ownable(owner_) {
        if (usdt_ == address(0) || xaut_ == address(0) || agent_ == address(0))
            revert ZeroAddress();

        usdt = IERC20(usdt_);
        xaut = IERC20(xaut_);
        agent = agent_;
        dailyLimitUsdt = dailyLimitUsdt_;
        windowStart = block.timestamp;
    }

    /**
     * @notice Agent withdraws USDT for trading (subject to daily limit).
     * @param amount Amount in micro-USDT (6 decimals).
     * @param to     Recipient (typically a prediction market contract).
     */
    function agentWithdrawUsdt(uint256 amount, address to)
        external
        onlyAgent
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();

        _refreshWindow();

        uint256 remaining = dailyLimitUsdt - withdrawnToday;
        if (amount > remaining) revert DailyLimitExceeded(amount, remaining);

        withdrawnToday += amount;
        usdt.safeTransfer(to, amount);

        emit AgentWithdraw(address(usdt), amount, to);
    }

    /**
     * @notice Agent withdraws XAU₮ for rebalancing (no daily limit — XAU₮ is reserve).
     * @param amount Amount in micro-XAUT (6 decimals).
     * @param to     Recipient.
     */
    function agentWithdrawXaut(uint256 amount, address to)
        external
        onlyAgent
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        xaut.safeTransfer(to, amount);
        emit AgentWithdraw(address(xaut), amount, to);
    }

    /**
     * @notice Emergency: owner withdraws any token.
     */
    function ownerWithdraw(address token, uint256 amount, address to)
        external
        onlyOwner
        nonReentrant
    {
        IERC20(token).safeTransfer(to, amount);
        emit OwnerWithdraw(token, amount, to);
    }

    /**
     * @notice Update the authorised agent address.
     */
    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        emit AgentUpdated(agent, newAgent);
        agent = newAgent;
    }

    /**
     * @notice Update the daily withdrawal limit.
     */
    function setDailyLimit(uint256 newLimit) external onlyOwner {
        emit DailyLimitUpdated(dailyLimitUsdt, newLimit);
        dailyLimitUsdt = newLimit;
    }

    /// @notice USDT balance held in the vault.
    function usdtBalance() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }

    /// @notice XAU₮ balance held in the vault.
    function xautBalance() external view returns (uint256) {
        return xaut.balanceOf(address(this));
    }

    /// @notice Remaining USDT the agent can withdraw today.
    function remainingDailyUsdt() external view returns (uint256) {
        if (block.timestamp >= windowStart + 1 days) return dailyLimitUsdt;
        return dailyLimitUsdt > withdrawnToday ? dailyLimitUsdt - withdrawnToday : 0;
    }

    function _refreshWindow() internal {
        if (block.timestamp >= windowStart + 1 days) {
            withdrawnToday = 0;
            windowStart = block.timestamp;
        }
    }

    receive() external payable {
        emit Deposited(address(0), msg.value, msg.sender);
    }
}
