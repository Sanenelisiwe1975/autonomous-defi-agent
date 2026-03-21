// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./PredictionMarket.sol";

/**
 * @title MarketFactory
 * @notice Registry and factory for PredictionMarket contracts.
 *
 * The autonomous agent queries this contract during the Observe phase
 * to discover active markets and their parameters (AMM reserves,
 * closing times, implied probabilities).
 *
 * Anyone (or only the owner, depending on permissionless) can create markets.
 */
contract MarketFactory is Ownable {

    address public immutable usdt;

    uint256 public defaultFeeBps;

    bool public permissionless;

    address[] public markets;

    mapping(address => bool) public isActive;

    event MarketCreated(
        address indexed market,
        string question,
        uint256 closingTime,
        address creator
    );
    event MarketDeactivated(address indexed market);

    constructor(
        address usdt_,
        uint256 defaultFeeBps_,
        bool permissionless_,
        address owner_
    ) Ownable(owner_) {
        usdt = usdt_;
        defaultFeeBps = defaultFeeBps_;
        permissionless = permissionless_;
    }

    /**
     * @notice Deploy a new binary prediction market.
     * @param question_       Human-readable question to resolve.
     * @param closingTime_    Unix timestamp after which no new positions can be entered.
     * @param initialYesUsdt  USDT seeded to the YES side (6 decimals).
     * @param initialNoUsdt   USDT seeded to the NO side (6 decimals).
     * @return market         Address of the deployed PredictionMarket.
     */
    function createMarket(
        string calldata question_,
        uint256 closingTime_,
        uint256 initialYesUsdt,
        uint256 initialNoUsdt
    ) external returns (address market) {
        require(
            permissionless || msg.sender == owner(),
            "MarketFactory: not authorised"
        );
        require(closingTime_ > block.timestamp, "MarketFactory: closing in past");

        uint256 seed = initialYesUsdt + initialNoUsdt;

        PredictionMarket pm = new PredictionMarket(
            question_,
            usdt,
            closingTime_,
            initialYesUsdt,
            initialNoUsdt,
            defaultFeeBps,
            msg.sender
        );

        market = address(pm);

        if (seed > 0) {
            IERC20(usdt).transferFrom(msg.sender, market, seed);
        }

        markets.push(market);
        isActive[market] = true;

        emit MarketCreated(market, question_, closingTime_, msg.sender);
    }

    /**
     * @notice Returns all active market addresses.
     * @dev The agent calls this during the Observe phase.
     */
    function getActiveMarkets() external view returns (address[] memory) {
        uint256 count;
        for (uint256 i = 0; i < markets.length; i++) {
            if (isActive[markets[i]]) count++;
        }

        address[] memory active = new address[](count);
        uint256 idx;
        for (uint256 i = 0; i < markets.length; i++) {
            if (isActive[markets[i]]) {
                active[idx++] = markets[i];
            }
        }
        return active;
    }

    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    function deactivateMarket(address market) external onlyOwner {
        isActive[market] = false;
        emit MarketDeactivated(market);
    }

    function setDefaultFeeBps(uint256 feeBps_) external onlyOwner {
        defaultFeeBps = feeBps_;
    }

    function setPermissionless(bool value) external onlyOwner {
        permissionless = value;
    }
}
