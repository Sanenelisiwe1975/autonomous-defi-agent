// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;


interface IMarket {
    
    enum MarketState { OPEN, CLOSED, RESOLVED, DISPUTED, CANCELLED }
    enum OutcomeIndex { INVALID, YES, NO }          // 0 = unset / invalid


    struct MarketInfo {
        bytes32   marketId;
        string    question;
        uint64    createdAt;
        uint64    closesAt;
        uint64    resolvesAt;
        MarketState state;
        OutcomeIndex resolution;
        address   collateralToken;   // USD₮ or XAU₮
        address   yesToken;
        address   noToken;
        uint256   totalLiquidity;
        uint256   feeBps;            // Platform fee in basis points
    }

    struct Position {
        uint256 yesShares;
        uint256 noShares;
        uint256 lpShares;            // AMM liquidity-provider shares
        uint256 avgEntryPrice;       // Weighted avg in 1e18 scale
    }


    event SharesBought(address indexed buyer, OutcomeIndex outcome, uint256 amount, uint256 cost);
    event SharesSold(address indexed seller, OutcomeIndex outcome, uint256 amount, uint256 proceeds);
    event LiquidityAdded(address indexed provider, uint256 collateral, uint256 lpShares);
    event LiquidityRemoved(address indexed provider, uint256 lpShares, uint256 collateral);
    event MarketResolved(OutcomeIndex outcome, address resolver);
    event WinningsClaimed(address indexed claimer, uint256 amount);


    function getMarketInfo() external view returns (MarketInfo memory);
    function getPosition(address account) external view returns (Position memory);
    function getPrice(OutcomeIndex outcome) external view returns (uint256 price18);   // 1e18 = $1
    function getExpectedShares(OutcomeIndex outcome, uint256 collateralIn) external view returns (uint256 shares);
    function getExpectedCollateral(OutcomeIndex outcome, uint256 sharesIn) external view returns (uint256 collateral);
    function getLiquidity() external view returns (uint256 yes, uint256 no, uint256 total);

    

    
    function buy(OutcomeIndex outcome, uint256 collateralIn, uint256 minSharesOut)
        external returns (uint256 sharesOut);

    function sell(OutcomeIndex outcome, uint256 sharesIn, uint256 minCollateralOut)
        external returns (uint256 collateralOut);

    function addLiquidity(uint256 collateralIn, uint256 minLpOut)
        external returns (uint256 lpShares);

    function removeLiquidity(uint256 lpShares, uint256 minCollateralOut)
        external returns (uint256 collateralOut);

    function claimWinnings() external returns (uint256 payout);

    function cancel() external;
}
