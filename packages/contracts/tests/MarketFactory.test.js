// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/MarketFactory.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  Mock contracts
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Minimal PredictionMarket implementation used as the clone template.
///      Stores whatever initialize() receives so tests can assert on it.
contract MockMarketImpl is IPredictionMarket {
    address public override creator;
    string  public override question;
    uint256 public override resolutionTime;
    bool    public override resolved;
    address public feeRecipient;
    uint256 public protocolFeeBps;
    bool    public initialized;

    function initialize(
        address _creator,
        string calldata _question,
        uint256 _resolutionTime,
        address _feeRecipient,
        uint256 _protocolFeeBps
    ) external override {
        require(!initialized, "already initialized");
        creator         = _creator;
        question        = _question;
        resolutionTime  = _resolutionTime;
        feeRecipient    = _feeRecipient;
        protocolFeeBps  = _protocolFeeBps;
        initialized     = true;
    }
}

/// @dev Mock ERC-20 that records transfer calls and lets us control success/failure.
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    bool public transferShouldFail;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setTransferFail(bool fail) external {
        transferShouldFail = fail;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (transferShouldFail) return false;
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        return true;
    }
}

/// @dev Attacker contract – attempts a reentrant collectETHFees call.
contract ReentrancyAttacker {
    MarketFactory public factory;
    bool public attacked;

    constructor(MarketFactory _factory) { factory = _factory; }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            factory.collectETHFees(); // reentrant call – should revert
        }
    }

    function attack() external {
        factory.collectETHFees();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Test suite
// ─────────────────────────────────────────────────────────────────────────────

contract MarketFactoryTest is Test {

    // ── actors ───────────────────────────────────────────────
    address internal owner      = makeAddr("owner");
    address internal alice      = makeAddr("alice");
    address internal bob        = makeAddr("bob");
    address internal feeWallet  = makeAddr("feeWallet");

    // ── contracts ────────────────────────────────────────────
    MarketFactory   internal factory;
    MockMarketImpl  internal impl;
    MockERC20       internal token;

    // ── helpers ──────────────────────────────────────────────
    uint256 internal constant FEE_BPS         = 100;   // 1 %
    uint256 internal constant RESOLUTION_TIME = 7 days;
    string  internal constant QUESTION        = "Will ETH hit $10k by end of 2025?";

    // Returns a resolution timestamp always in the future
    function _futureTs() internal view returns (uint256) {
        return block.timestamp + RESOLUTION_TIME;
    }

    // Deploy a market as alice and return its address
    function _deployAsAlice() internal returns (address) {
        vm.prank(alice);
        return factory.deployMarket(QUESTION, _futureTs());
    }

    // ─────────────────────────────────────────────────────────
    //  setUp
    // ─────────────────────────────────────────────────────────

    function setUp() public {
        impl  = new MockMarketImpl();
        token = new MockERC20();

        vm.prank(owner);
        factory = new MarketFactory(address(impl), FEE_BPS, feeWallet);
    }

    // ═════════════════════════════════════════════════════════
    //  1. CONSTRUCTOR
    // ═════════════════════════════════════════════════════════

    function test_constructor_setsState() public view {
        assertEq(factory.marketImplementation(), address(impl));
        assertEq(factory.protocolFeeBps(),       FEE_BPS);
        assertEq(factory.feeRecipient(),          feeWallet);
        assertEq(factory.owner(),                 owner);
        assertEq(factory.totalMarkets(),          0);
    }

    function test_constructor_revertsOnZeroImplementation() public {
        vm.expectRevert("Factory: zero implementation");
        new MarketFactory(address(0), FEE_BPS, feeWallet);
    }

    function test_constructor_revertsOnZeroFeeRecipient() public {
        vm.expectRevert("Factory: zero fee recipient");
        new MarketFactory(address(impl), FEE_BPS, address(0));
    }

    function test_constructor_revertsWhenFeeExceedsMax() public {
        vm.expectRevert("Factory: fee exceeds max");
        new MarketFactory(address(impl), 1_001, feeWallet);
    }

    function test_constructor_acceptsMaxFee() public {
        MarketFactory f = new MarketFactory(address(impl), 1_000, feeWallet);
        assertEq(f.protocolFeeBps(), 1_000);
    }

    // ═════════════════════════════════════════════════════════
    //  2. deployMarket
    // ═════════════════════════════════════════════════════════

    function test_deployMarket_success() public {
        uint256 resTs = _futureTs();
        vm.prank(alice);
        address market = factory.deployMarket(QUESTION, resTs);

        // non-zero address deployed
        assertTrue(market != address(0));

        // registry updated
        assertEq(factory.totalMarkets(),   1);
        assertTrue(factory.isRegisteredMarket(market));
        assertEq(factory.marketIndex(market), 1); // 1-indexed

        // MarketInfo stored correctly
        (
            address mAddr,
            address mCreator,
            string memory mQuestion,
            uint256 mResTs,
            uint256 mCreatedAt,
            bool    mActive
        ) = factory.markets(0);

        assertEq(mAddr,     market);
        assertEq(mCreator,  alice);
        assertEq(mQuestion, QUESTION);
        assertEq(mResTs,    resTs);
        assertEq(mCreatedAt, block.timestamp);
        assertTrue(mActive);

        // creator mapping
        address[] memory byCreator = factory.getMarketsByCreator(alice);
        assertEq(byCreator.length, 1);
        assertEq(byCreator[0],     market);
    }

    function test_deployMarket_initializesCloneCorrectly() public {
        uint256 resTs  = _futureTs();
        vm.prank(alice);
        address market = factory.deployMarket(QUESTION, resTs);

        MockMarketImpl m = MockMarketImpl(market);
        assertEq(m.creator(),        alice);
        assertEq(m.question(),       QUESTION);
        assertEq(m.resolutionTime(), resTs);
        assertEq(m.feeRecipient(),   feeWallet);
        assertEq(m.protocolFeeBps(), FEE_BPS);
        assertTrue(m.initialized());
    }

    function test_deployMarket_emitsEvent() public {
        uint256 resTs = _futureTs();

        // We can't predict the clone address ahead of time, so we just check
        // the non-address indexed fields via a partial expectEmit.
        vm.expectEmit(false, true, true, true);
        emit MarketFactory.MarketDeployed(address(0), alice, QUESTION, resTs, 0);

        vm.prank(alice);
        factory.deployMarket(QUESTION, resTs);
    }

    function test_deployMarket_revertsOnEmptyQuestion() public {
        vm.expectRevert("Factory: empty question");
        vm.prank(alice);
        factory.deployMarket("", _futureTs());
    }

    function test_deployMarket_revertsWhenResolutionInPast() public {
        vm.expectRevert("Factory: resolution in past");
        vm.prank(alice);
        factory.deployMarket(QUESTION, block.timestamp); // equal = past
    }

    function test_deployMarket_revertsWhenPaused() public {
        vm.prank(owner);
        factory.pause();

        vm.expectRevert();
        vm.prank(alice);
        factory.deployMarket(QUESTION, _futureTs());
    }

    function test_deployMarket_multipleMarketsTrackedCorrectly() public {
        vm.startPrank(alice);
        address m1 = factory.deployMarket("Q1?", _futureTs());
        address m2 = factory.deployMarket("Q2?", _futureTs());
        vm.stopPrank();

        vm.prank(bob);
        address m3 = factory.deployMarket("Q3?", _futureTs());

        assertEq(factory.totalMarkets(), 3);

        address[] memory byAlice = factory.getMarketsByCreator(alice);
        assertEq(byAlice.length, 2);
        assertEq(byAlice[0], m1);
        assertEq(byAlice[1], m2);

        address[] memory byBob = factory.getMarketsByCreator(bob);
        assertEq(byBob.length, 1);
        assertEq(byBob[0], m3);
    }

    function test_deployMarket_clonesAreIndependent() public {
        vm.prank(alice);
        address m1 = factory.deployMarket("Q1?", _futureTs());
        vm.prank(bob);
        address m2 = factory.deployMarket("Q2?", _futureTs());

        assertTrue(m1 != m2);
        assertEq(MockMarketImpl(m1).creator(), alice);
        assertEq(MockMarketImpl(m2).creator(), bob);
    }

    // ═════════════════════════════════════════════════════════
    //  3. Registry helpers
    // ═════════════════════════════════════════════════════════

    function test_isRegisteredMarket_falseForUnknown() public view {
        assertFalse(factory.isRegisteredMarket(address(0xDEAD)));
    }

    function test_getMarkets_pagination() public {
        // Deploy 5 markets
        for (uint i = 0; i < 5; i++) {
            vm.prank(alice);
            factory.deployMarket(string(abi.encodePacked("Q", i)), _futureTs());
        }

        // Page 1: first 3
        MarketFactory.MarketInfo[] memory page1 = factory.getMarkets(0, 3);
        assertEq(page1.length, 3);

        // Page 2: next 3 (only 2 remaining)
        MarketFactory.MarketInfo[] memory page2 = factory.getMarkets(3, 3);
        assertEq(page2.length, 2);

        // Beyond total
        MarketFactory.MarketInfo[] memory empty = factory.getMarkets(10, 5);
        assertEq(empty.length, 0);
    }

    function test_getMarkets_singleEntry() public {
        _deployAsAlice();
        MarketFactory.MarketInfo[] memory page = factory.getMarkets(0, 100);
        assertEq(page.length, 1);
        assertEq(page[0].creator, alice);
    }

    // ═════════════════════════════════════════════════════════
    //  4. setMarketInactive
    // ═════════════════════════════════════════════════════════

    function test_setMarketInactive_byOwner() public {
        address market = _deployAsAlice();

        vm.expectEmit(true, false, false, true);
        emit MarketFactory.MarketStatusUpdated(market, false);

        vm.prank(owner);
        factory.setMarketInactive(market);

        (,,,,,bool active) = factory.markets(0);
        assertFalse(active);
    }

    function test_setMarketInactive_byMarketItself() public {
        address market = _deployAsAlice();

        vm.prank(market);
        factory.setMarketInactive(market);

        (,,,,,bool active) = factory.markets(0);
        assertFalse(active);
    }

    function test_setMarketInactive_revertsForUnauthorized() public {
        address market = _deployAsAlice();

        vm.expectRevert("Factory: unauthorized");
        vm.prank(bob);
        factory.setMarketInactive(market);
    }

    function test_setMarketInactive_revertsForUnregistered() public {
        vm.expectRevert("Factory: not registered");
        vm.prank(owner);
        factory.setMarketInactive(address(0xDEAD));
    }

    // ═════════════════════════════════════════════════════════
    //  5. Fee accrual – accrueETHFee
    // ═════════════════════════════════════════════════════════

    function test_accrueETHFee_succeeds() public {
        address market = _deployAsAlice();

        vm.deal(market, 1 ether);
        vm.prank(market);
        factory.accrueETHFee{value: 1 ether}();

        assertEq(factory.accumulatedFees(address(0)), 1 ether);
    }

    function test_accrueETHFee_emitsEvent() public {
        address market = _deployAsAlice();
        vm.deal(market, 0.5 ether);

        vm.expectEmit(true, false, false, true);
        emit MarketFactory.FeeAccrued(address(0), 0.5 ether);

        vm.prank(market);
        factory.accrueETHFee{value: 0.5 ether}();
    }

    function test_accrueETHFee_revertsForNonMarket() public {
        vm.deal(bob, 1 ether);
        vm.expectRevert("Factory: caller not a market");
        vm.prank(bob);
        factory.accrueETHFee{value: 1 ether}();
    }

    function test_receive_accruesFromRegisteredMarket() public {
        address market = _deployAsAlice();

        vm.deal(market, 1 ether);
        vm.prank(market);
        (bool ok,) = address(factory).call{value: 1 ether}("");
        assertTrue(ok);

        assertEq(factory.accumulatedFees(address(0)), 1 ether);
    }

    function test_receive_ignoresUnregisteredSender() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        // Should NOT revert, but also should NOT accrue
        (bool ok,) = address(factory).call{value: 1 ether}("");
        assertTrue(ok);

        assertEq(factory.accumulatedFees(address(0)), 0);
    }

    // ═════════════════════════════════════════════════════════
    //  6. collectETHFees
    // ═════════════════════════════════════════════════════════

    function _seedETHFee(uint256 amount) internal {
        address market = _deployAsAlice();
        vm.deal(market, amount);
        vm.prank(market);
        factory.accrueETHFee{value: amount}();
    }

    function test_collectETHFees_transfersToRecipient() public {
        _seedETHFee(2 ether);

        uint256 before = feeWallet.balance;
        factory.collectETHFees();
        assertEq(feeWallet.balance - before, 2 ether);
        assertEq(factory.accumulatedFees(address(0)), 0);
    }

    function test_collectETHFees_emitsEvent() public {
        _seedETHFee(1 ether);

        vm.expectEmit(true, false, true, true);
        emit MarketFactory.FeesCollected(address(0), 1 ether, feeWallet);

        factory.collectETHFees();
    }

    function test_collectETHFees_revertsWhenZero() public {
        vm.expectRevert("Factory: no ETH fees");
        factory.collectETHFees();
    }

    function test_collectETHFees_anyoneCanCall() public {
        _seedETHFee(1 ether);
        // bob (non-owner) initiates; funds still go to feeWallet
        vm.prank(bob);
        factory.collectETHFees();
        assertEq(feeWallet.balance, 1 ether);
    }

    function test_collectETHFees_reentrancyProtected() public {
        // Set up attacker as the fee recipient
        ReentrancyAttacker attacker = new ReentrancyAttacker(factory);

        vm.prank(owner);
        factory.setFeeRecipient(address(attacker));

        // Seed fees
        address market = _deployAsAlice();
        vm.deal(market, 1 ether);
        vm.prank(market);
        factory.accrueETHFee{value: 1 ether}();

        // Attack should revert due to ReentrancyGuard
        vm.expectRevert();
        attacker.attack();
    }

    // ═════════════════════════════════════════════════════════
    //  7. collectERC20Fees
    // ═════════════════════════════════════════════════════════

    function _seedERC20Fee(uint256 amount) internal {
        token.mint(address(factory), amount);
        // Manually set accumulated balance (simulate market reporting)
        // We use a cheat: directly write storage via stdstore.
        // Simpler: just have a registered market call accrueERC20 via low-level.
        // For the test we write the storage slot directly.
        vm.store(
            address(factory),
            keccak256(abi.encode(address(token), uint256(6))), // slot 6 = accumulatedFees mapping
            bytes32(amount)
        );
    }

    function test_collectERC20Fees_transfersToRecipient() public {
        _seedERC20Fee(500);

        factory.collectERC20Fees(address(token));

        assertEq(token.balanceOf(feeWallet), 500);
        assertEq(factory.accumulatedFees(address(token)), 0);
    }

    function test_collectERC20Fees_emitsEvent() public {
        _seedERC20Fee(250);

        vm.expectEmit(true, false, true, true);
        emit MarketFactory.FeesCollected(address(token), 250, feeWallet);

        factory.collectERC20Fees(address(token));
    }

    function test_collectERC20Fees_revertsOnAddressZero() public {
        vm.expectRevert("Factory: use collectETHFees");
        factory.collectERC20Fees(address(0));
    }

    function test_collectERC20Fees_revertsWhenZeroBalance() public {
        vm.expectRevert("Factory: no token fees");
        factory.collectERC20Fees(address(token));
    }

    function test_collectERC20Fees_revertsOnTransferFailure() public {
        _seedERC20Fee(100);
        token.setTransferFail(true);

        vm.expectRevert("Factory: token transfer failed");
        factory.collectERC20Fees(address(token));
    }

    // ═════════════════════════════════════════════════════════
    //  8. Admin – setMarketImplementation
    // ═════════════════════════════════════════════════════════

    function test_setMarketImplementation_success() public {
        MockMarketImpl newImpl = new MockMarketImpl();

        vm.expectEmit(true, true, false, false);
        emit MarketFactory.ImplementationUpdated(address(impl), address(newImpl));

        vm.prank(owner);
        factory.setMarketImplementation(address(newImpl));

        assertEq(factory.marketImplementation(), address(newImpl));
    }

    function test_setMarketImplementation_revertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("Factory: zero address");
        factory.setMarketImplementation(address(0));
    }

    function test_setMarketImplementation_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        factory.setMarketImplementation(address(impl));
    }

    function test_setMarketImplementation_newMarketsUseNewImpl() public {
        // Deploy a market with the original impl
        address m1 = _deployAsAlice();

        // Switch implementation
        MockMarketImpl newImpl = new MockMarketImpl();
        vm.prank(owner);
        factory.setMarketImplementation(address(newImpl));

        // Deploy a new market
        vm.prank(bob);
        address m2 = factory.deployMarket("New impl question?", _futureTs());

        // Both should be initialized correctly (they're different clones)
        assertEq(MockMarketImpl(m1).creator(), alice);
        assertEq(MockMarketImpl(m2).creator(), bob);
        assertTrue(m1 != m2);
    }

    // ═════════════════════════════════════════════════════════
    //  9. Admin – setProtocolFee
    // ═════════════════════════════════════════════════════════

    function test_setProtocolFee_success() public {
        vm.expectEmit(false, false, false, true);
        emit MarketFactory.FeeUpdated(FEE_BPS, 200);

        vm.prank(owner);
        factory.setProtocolFee(200);

        assertEq(factory.protocolFeeBps(), 200);
    }

    function test_setProtocolFee_acceptsZero() public {
        vm.prank(owner);
        factory.setProtocolFee(0);
        assertEq(factory.protocolFeeBps(), 0);
    }

    function test_setProtocolFee_acceptsMax() public {
        vm.prank(owner);
        factory.setProtocolFee(1_000);
        assertEq(factory.protocolFeeBps(), 1_000);
    }

    function test_setProtocolFee_revertsAboveMax() public {
        vm.prank(owner);
        vm.expectRevert("Factory: fee exceeds max");
        factory.setProtocolFee(1_001);
    }

    function test_setProtocolFee_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        factory.setProtocolFee(50);
    }

    // ═════════════════════════════════════════════════════════
    //  10. Admin – setFeeRecipient
    // ═════════════════════════════════════════════════════════

    function test_setFeeRecipient_success() public {
        vm.expectEmit(true, true, false, false);
        emit MarketFactory.FeeRecipientUpdated(feeWallet, bob);

        vm.prank(owner);
        factory.setFeeRecipient(bob);

        assertEq(factory.feeRecipient(), bob);
    }

    function test_setFeeRecipient_revertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("Factory: zero address");
        factory.setFeeRecipient(address(0));
    }

    function test_setFeeRecipient_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        factory.setFeeRecipient(bob);
    }

    // ═════════════════════════════════════════════════════════
    //  11. Pause / Unpause
    // ═════════════════════════════════════════════════════════

    function test_pause_preventsDeployment() public {
        vm.prank(owner);
        factory.pause();

        vm.expectRevert();
        vm.prank(alice);
        factory.deployMarket(QUESTION, _futureTs());
    }

    function test_unpause_allowsDeploymentAgain() public {
        vm.startPrank(owner);
        factory.pause();
        factory.unpause();
        vm.stopPrank();

        // Should succeed
        address market = _deployAsAlice();
        assertTrue(market != address(0));
    }

    function test_pause_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        factory.pause();
    }

    function test_unpause_revertsForNonOwner() public {
        vm.prank(owner);
        factory.pause();

        vm.prank(alice);
        vm.expectRevert();
        factory.unpause();
    }

    // ═════════════════════════════════════════════════════════
    //  12. Fuzz tests
    // ═════════════════════════════════════════════════════════

    /// @dev Any fee within bounds must be accepted
    function testFuzz_setProtocolFee_withinBounds(uint256 feeBps) public {
        feeBps = bound(feeBps, 0, 1_000);
        vm.prank(owner);
        factory.setProtocolFee(feeBps);
        assertEq(factory.protocolFeeBps(), feeBps);
    }

    /// @dev Any fee above max must revert
    function testFuzz_setProtocolFee_aboveMax(uint256 feeBps) public {
        feeBps = bound(feeBps, 1_001, type(uint256).max);
        vm.prank(owner);
        vm.expectRevert("Factory: fee exceeds max");
        factory.setProtocolFee(feeBps);
    }

    /// @dev Resolution time at or before current timestamp must revert
    function testFuzz_deployMarket_resolutionInPast(uint256 ts) public {
        ts = bound(ts, 0, block.timestamp);
        vm.expectRevert("Factory: resolution in past");
        vm.prank(alice);
        factory.deployMarket(QUESTION, ts);
    }

    /// @dev ETH accrual from any registered market must accumulate correctly
    function testFuzz_accrueETHFee(uint96 amount) public {
        vm.assume(amount > 0);
        address market = _deployAsAlice();

        vm.deal(market, amount);
        vm.prank(market);
        factory.accrueETHFee{value: amount}();

        assertEq(factory.accumulatedFees(address(0)), amount);
    }

    function testFuzz_deployMarket_countConsistency(uint8 n) public {
        vm.assume(n > 0 && n <= 20);
        for (uint i = 0; i < n; i++) {
            vm.prank(alice);
            factory.deployMarket(string(abi.encodePacked("Q", i)), _futureTs());
        }
        assertEq(factory.totalMarkets(), n);
        assertEq(factory.getMarketsByCreator(alice).length, n);
    }

   
    function test_integration_fullLifecycle() public {
        // 1. Deploy first market
        vm.prank(alice);
        address m1 = factory.deployMarket("Will BTC flip ETH?", _futureTs());
        assertTrue(factory.isRegisteredMarket(m1));

        // 2. Market accrues fee
        vm.deal(m1, 0.1 ether);
        vm.prank(m1);
        factory.accrueETHFee{value: 0.1 ether}();
        assertEq(factory.accumulatedFees(address(0)), 0.1 ether);

        // 3. Collect fees
        uint256 before = feeWallet.balance;
        factory.collectETHFees();
        assertEq(feeWallet.balance - before, 0.1 ether);

        // 4. Owner updates fee and recipient
        vm.startPrank(owner);
        factory.setProtocolFee(200);
        factory.setFeeRecipient(bob);
        vm.stopPrank();

        // 5. Deploy second market – should receive updated config
        vm.prank(bob);
        address m2 = factory.deployMarket("Will Solana flip ETH?", _futureTs());
        assertEq(MockMarketImpl(m2).protocolFeeBps(), 200);
        assertEq(MockMarketImpl(m2).feeRecipient(),   bob);

        // 6. Mark first market inactive
        vm.prank(owner);
        factory.setMarketInactive(m1);
        (,,,,,bool active) = factory.markets(0);
        assertFalse(active);

        
        assertEq(factory.totalMarkets(), 2);
    }
}
