// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./iMarket.sol";


 
contract ConditionalPayment {

    enum PayoffType { LINEAR, BINARY, CUSTOM }

    struct Payment {
        bytes32              id;
        address              creator;
        address              beneficiary;
        address              market;
        bytes32              marketId;
        address              collateralToken;
        uint256              totalAmount;
        uint256              claimedAmount;
        IMarket.OutcomeIndex triggerOutcome;  // Outcome that releases funds
        PayoffType           payoffType;
        bytes                customPayoff;    // ABI-encoded custom curve params
        uint256              expiresAt;       // Refund if market unresolved by this time
        bool                 cancelled;
    }


    address public owner;
    uint256 private _nextId;

    mapping(bytes32 => Payment) public payments;
    mapping(address => bytes32[]) public beneficiaryPayments;
    mapping(address => bytes32[]) public creatorPayments;

    event PaymentCreated(
        bytes32 indexed id,
        address indexed creator,
        address indexed beneficiary,
        bytes32 marketId,
        uint256 amount,
        IMarket.OutcomeIndex triggerOutcome
    );
    event PaymentClaimed(bytes32 indexed id, address beneficiary, uint256 amount);
    event PaymentRefunded(bytes32 indexed id, address creator, uint256 amount);
    event PaymentCancelled(bytes32 indexed id);


    error Unauthorized();
    error AlreadyClaimed();
    error NotTriggered();
    error NotExpired();
    error ZeroAmount();
    error ZeroAddress();
    error Cancelled();


    constructor(address _owner) {
        owner = _owner;
    }

    function createPayment(
        address              beneficiary,
        address              market,
        bytes32              marketId,
        address              collateral,
        uint256              amount,
        IMarket.OutcomeIndex trigger,
        PayoffType           payoffType,
        bytes calldata       customPayoff,
        uint256              expiresAt
    ) external returns (bytes32 paymentId) {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (amount == 0)               revert ZeroAmount();
        if (trigger == IMarket.OutcomeIndex.INVALID) revert NotTriggered();

        IERC20(collateral).transferFrom(msg.sender, address(this), amount);

        paymentId = keccak256(abi.encodePacked(
            msg.sender, beneficiary, marketId, amount, block.number, _nextId++
        ));

        payments[paymentId] = Payment({
            id:              paymentId,
            creator:         msg.sender,
            beneficiary:     beneficiary,
            market:          market,
            marketId:        marketId,
            collateralToken: collateral,
            totalAmount:     amount,
            claimedAmount:   0,
            triggerOutcome:  trigger,
            payoffType:      payoffType,
            customPayoff:    customPayoff,
            expiresAt:       expiresAt,
            cancelled:       false
        });

        beneficiaryPayments[beneficiary].push(paymentId);
        creatorPayments[msg.sender].push(paymentId);

        emit PaymentCreated(paymentId, msg.sender, beneficiary, marketId, amount, trigger);
    }

    function claimPayment(bytes32 paymentId) external returns (uint256 payout) {
        Payment storage p = payments[paymentId];
        if (p.cancelled)                          revert Cancelled();
        if (msg.sender != p.beneficiary)          revert Unauthorized();
        if (p.claimedAmount >= p.totalAmount)     revert AlreadyClaimed();

        IMarket.MarketInfo memory info = IMarket(p.market).getMarketInfo();
        if (info.state != IMarket.MarketState.RESOLVED)        revert NotTriggered();
        if (info.resolution != p.triggerOutcome)               revert NotTriggered();

        payout = _computePayout(p, info);
        p.claimedAmount += payout;

        IERC20(p.collateralToken).transfer(msg.sender, payout);
        emit PaymentClaimed(paymentId, msg.sender, payout);
    }

    function refundPayment(bytes32 paymentId) external {
        Payment storage p = payments[paymentId];
        if (p.creator != msg.sender)          revert Unauthorized();
        if (p.cancelled)                      revert Cancelled();
        if (block.timestamp < p.expiresAt)    revert NotExpired();

        IMarket.MarketInfo memory info = IMarket(p.market).getMarketInfo();
        // Only refund if market is not resolved with the trigger outcome
        bool triggered = (info.state == IMarket.MarketState.RESOLVED &&
                          info.resolution == p.triggerOutcome);
        require(!triggered, "Market triggered - claim instead");

        uint256 remaining = p.totalAmount - p.claimedAmount;
        p.cancelled = true;

        IERC20(p.collateralToken).transfer(p.creator, remaining);
        emit PaymentRefunded(paymentId, p.creator, remaining);
    }

    function cancelPayment(bytes32 paymentId) external {
        Payment storage p = payments[paymentId];
        if (p.creator != msg.sender) revert Unauthorized();
        if (p.cancelled)             revert Cancelled();

        IMarket.MarketInfo memory info = IMarket(p.market).getMarketInfo();
        require(info.state == IMarket.MarketState.OPEN, "Market closed");

        uint256 remaining = p.totalAmount - p.claimedAmount;
        p.cancelled = true;

        IERC20(p.collateralToken).transfer(p.creator, remaining);
        emit PaymentCancelled(paymentId);
    }

    

    function getPayment(bytes32 id) external view returns (Payment memory) {
        return payments[id];
    }

    function getBeneficiaryPayments(address user) external view returns (bytes32[] memory) {
        return beneficiaryPayments[user];
    }

    function getCreatorPayments(address user) external view returns (bytes32[] memory) {
        return creatorPayments[user];
    }


    function _computePayout(Payment storage p, IMarket.MarketInfo memory info)
        internal view returns (uint256)
    {
        if (p.payoffType == PayoffType.BINARY) {
            return p.totalAmount - p.claimedAmount;
        }
        if (p.payoffType == PayoffType.LINEAR) {
            // Pro-rata based on beneficiary's share of winning outcome tokens
            address winToken = (info.resolution == IMarket.OutcomeIndex.YES)
                ? info.yesToken : info.noToken;
            uint256 totalWinShares = IERC20(winToken).totalSupply();
            uint256 userShares     = IERC20(winToken).balanceOf(p.beneficiary);
            if (totalWinShares == 0) return 0;
            return (p.totalAmount * userShares) / totalWinShares;
        }
        return p.totalAmount - p.claimedAmount;
    }
}
