// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20Extended.sol";


contract SubscriptionManager {

    enum Plan { FREE, BASIC, PRO, INSTITUTIONAL }

    struct PlanConfig {
        uint256 pricePerPeriod;
        uint256 period;
        uint256 gracePeriod;
        bool    active;
    }

    struct SubscriptionRecord {
        address subscriber;
        Plan    plan;
        uint256 startedAt;
        uint256 paidUntil;
        uint256 totalPaid;
        bool    cancelled;
    }

    address public owner;
    address public treasury;
    address public collateralToken;

    mapping(Plan => PlanConfig) public plans;
    mapping(address => SubscriptionRecord) public subscriptions;

    uint256 public totalRevenue;
    uint256 public activeSubscribers;

    event Subscribed(address indexed subscriber, Plan plan, uint256 paidUntil);
    event Renewed(address indexed subscriber, uint256 newPaidUntil, uint256 amount);
    event Cancelled(address indexed subscriber, Plan plan);
    event PlanConfigured(Plan plan, uint256 price, uint256 period);
    event RevenueWithdrawn(uint256 amount);

    error Unauthorized();
    error PlanNotActive();
    error AlreadySubscribed();
    error NotSubscribed();
    error AlreadyCancelled();
    error SubscriptionActive();
    error ZeroAddress();

    constructor(address _owner, address _treasury, address _collateralToken) {
        owner           = _owner;
        treasury        = _treasury;
        collateralToken = _collateralToken;

        // Default plan configurations
        plans[Plan.FREE] = PlanConfig({
            pricePerPeriod: 0,
            period:         30 days,
            gracePeriod:    0,
            active:         true
        });
        plans[Plan.BASIC] = PlanConfig({
            pricePerPeriod: 29e6,      // $29 / month
            period:         30 days,
            gracePeriod:    3 days,
            active:         true
        });
        plans[Plan.PRO] = PlanConfig({
            pricePerPeriod: 99e6,      // $99 / month
            period:         30 days,
            gracePeriod:    5 days,
            active:         true
        });
        plans[Plan.INSTITUTIONAL] = PlanConfig({
            pricePerPeriod: 499e6,     // $499 / month
            period:         30 days,
            gracePeriod:    7 days,
            active:         true
        });
    }

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }

  
    function subscribe(Plan plan) external {
        PlanConfig storage config = plans[plan];
        if (!config.active) revert PlanNotActive();

        SubscriptionRecord storage sub = subscriptions[msg.sender];
        if (sub.startedAt != 0 && !sub.cancelled && isActive(msg.sender))
            revert AlreadySubscribed();

        uint256 price = config.pricePerPeriod;
        if (price > 0) {
            IERC20(collateralToken).transferFrom(msg.sender, treasury, price);
            totalRevenue += price;
        }

        uint256 paidUntil = block.timestamp + config.period;

        subscriptions[msg.sender] = SubscriptionRecord({
            subscriber: msg.sender,
            plan:       plan,
            startedAt:  block.timestamp,
            paidUntil:  paidUntil,
            totalPaid:  price,
            cancelled:  false
        });

        activeSubscribers++;
        emit Subscribed(msg.sender, plan, paidUntil);
    }


    function subscribeWithPermit(
        Plan    plan,
        uint256 deadline,
        uint8   v,
        bytes32 r,
        bytes32 s
    ) external {
        PlanConfig storage config = plans[plan];
        if (!config.active) revert PlanNotActive();

        uint256 price = config.pricePerPeriod;
        if (price > 0) {
            
            IERC20(collateralToken).permit(msg.sender, address(this), price, deadline, v, r, s);
            IERC20(collateralToken).transferFrom(msg.sender, treasury, price);
            totalRevenue += price;
        }

        uint256 paidUntil = block.timestamp + config.period;
        subscriptions[msg.sender] = SubscriptionRecord({
            subscriber: msg.sender,
            plan:       plan,
            startedAt:  block.timestamp,
            paidUntil:  paidUntil,
            totalPaid:  price,
            cancelled:  false
        });

        activeSubscribers++;
        emit Subscribed(msg.sender, plan, paidUntil);
    }


    function renew(address subscriber) external returns (uint256 newPaidUntil) {
        SubscriptionRecord storage sub = subscriptions[subscriber];
        if (sub.startedAt == 0)  revert NotSubscribed();
        if (sub.cancelled)       revert AlreadyCancelled();

        PlanConfig storage config = plans[sub.plan];
        uint256 price = config.pricePerPeriod;

        if (price > 0) {
            IERC20(collateralToken).transferFrom(subscriber, treasury, price);
            totalRevenue  += price;
            sub.totalPaid += price;
        }

        uint256 base   = sub.paidUntil > block.timestamp ? sub.paidUntil : block.timestamp;
        newPaidUntil   = base + config.period;
        sub.paidUntil  = newPaidUntil;

        emit Renewed(subscriber, newPaidUntil, price);
    }

    function cancel() external {
        SubscriptionRecord storage sub = subscriptions[msg.sender];
        if (sub.startedAt == 0) revert NotSubscribed();
        if (sub.cancelled)      revert AlreadyCancelled();

        sub.cancelled = true;
        activeSubscribers--;
        emit Cancelled(msg.sender, sub.plan);
    }


    function isActive(address account) public view returns (bool) {
        SubscriptionRecord storage sub = subscriptions[account];
        if (sub.startedAt == 0 || sub.cancelled) return false;
        PlanConfig storage config = plans[sub.plan];
        return block.timestamp <= sub.paidUntil + config.gracePeriod;
    }

    function getPlan(address account) external view returns (Plan) {
        return subscriptions[account].plan;
    }

    function getSubscriptionRecord(address account) external view returns (SubscriptionRecord memory) {
        return subscriptions[account];
    }

    function configurePlan(
        Plan    plan,
        uint256 price,
        uint256 period,
        uint256 gracePeriod,
        bool    active
    ) external onlyOwner {
        plans[plan] = PlanConfig(price, period, gracePeriod, active);
        emit PlanConfigured(plan, price, period);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }
}
