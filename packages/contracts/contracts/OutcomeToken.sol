// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title OutcomeToken
 * @notice ERC-20 token representing a binary outcome (YES or NO) position
 *         in a prediction market. Minted when a user enters a market;
 *         burned when they redeem.
 *
 * @dev Only the parent PredictionMarket contract (owner) can mint/burn.
 */
contract OutcomeToken is ERC20, Ownable {
    string public outcomeLabel;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory label_,
        address market_
    ) ERC20(name_, symbol_) Ownable(market_) {
        outcomeLabel = label_;
    }

    /**
     * @notice Mint outcome tokens to a buyer.
     * @dev Called by PredictionMarket when a user enters a position.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burn outcome tokens from a holder.
     * @dev Called by PredictionMarket when a user redeems or the market resolves.
     */
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
