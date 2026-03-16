// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMarket {

    function buyYes(uint256 amount) external;

    function buyNo(uint256 amount) external;
}

contract ExecutionRouter {

    function tradeYes(
        address market,
        uint256 amount
    ) external {

        IMarket(market).buyYes(amount);
    }

    function tradeNo(
        address market,
        uint256 amount
    ) external {

        IMarket(market).buyNo(amount);
    }
}