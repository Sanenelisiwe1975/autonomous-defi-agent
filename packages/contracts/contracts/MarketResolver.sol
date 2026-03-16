// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./iMarket.sol";
import "./PredictionMarket.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MarketResolver
 * @notice Resolves prediction markets through four mechanisms:
 *   1. MULTISIG   — committee member or owner proposes outcome
 *   2. CHAINLINK  — automatically reads a Chainlink price feed vs target
 *   3. AI_ORACLE  — the autonomous agent calls aiResolve() with on-chain rationale
 *   4. Dispute    — 48h window; anyone can post a $1000 USDT bond to challenge;
 *                   3-of-5 committee vote overrides if upheld
 *
 * The AI oracle path (aiResolve) is the primary path used by the agent loop.
 * The agent: observes market expiry → fetches Chainlink price → derives outcome →
 *            calls aiResolve() with reasoning stored on-chain as calldata →
 *            calls finalizeResolution() after the 24h dispute window.
 */
contract MarketResolver {

    enum ResolutionSource  { MULTISIG, CHAINLINK, UMA, AI_ORACLE }
    enum DisputeState      { NONE, PENDING, UPHELD, REJECTED }

    struct Resolution {
        IMarket.OutcomeIndex  outcome;
        ResolutionSource      source;
        uint256               timestamp;
        address               resolvedBy;
        bool                  finalized;
    }

    struct Dispute {
        address      challenger;
        uint256      bondAmount;
        uint256      timestamp;
        DisputeState state;
        string       reason;
    }

    uint256 public constant DISPUTE_PERIOD   = 48 hours;
    uint256 public constant DISPUTE_BOND     = 1000e6;   // 1 000 USD₮ (6 dec)
    uint256 public constant COMMITTEE_SIZE   = 5;
    uint256 public constant COMMITTEE_QUORUM = 3;

    address public owner;
    address public collateralToken;          

    address[5] public committee;
    mapping(address => bool) public isCommitteeMember;

    address public aiOracle;           

    mapping(bytes32 => address)  public chainlinkFeeds;  
    mapping(bytes32 => int256)   public resolutionPrices; 

    mapping(bytes32 => Resolution) public resolutions;
    mapping(bytes32 => Dispute)    public disputes;

    mapping(bytes32 => mapping(address => IMarket.OutcomeIndex)) public committeeVotes;
    mapping(bytes32 => uint256) public voteCount;

    mapping(bytes32 => address) public registeredMarkets; // marketId → PredictionMarket

    event MarketRegistered(bytes32 indexed marketId, address market);
    event ResolutionProposed(bytes32 indexed marketId, IMarket.OutcomeIndex outcome, ResolutionSource source, string rationale);
    event ResolutionFinalized(bytes32 indexed marketId, IMarket.OutcomeIndex outcome);
    event DisputeRaised(bytes32 indexed marketId, address challenger, string reason);
    event DisputeResolved(bytes32 indexed marketId, DisputeState state);
    event CommitteeVote(bytes32 indexed marketId, address member, IMarket.OutcomeIndex outcome);
    event ChainlinkFeedSet(bytes32 indexed marketId, address feed, int256 targetPrice);

    error Unauthorized();
    error MarketNotRegistered();
    error AlreadyResolved();
    error DisputePeriodActive();
    error NotInDisputePeriod();
    error DisputeBondInsufficient();
    error AlreadyDisputed();
    error AlreadyVoted();
    error NotCommitteeMember();
    error QuorumNotReached();
    error InvalidOutcome();

    constructor(
        address _owner,
        address _collateralToken,
        address[5] memory _committee,
        address _aiOracle
    ) {
        owner           = _owner;
        collateralToken = _collateralToken;
        aiOracle        = _aiOracle;

        for (uint256 i = 0; i < 5; i++) {
            committee[i]                     = _committee[i];
            isCommitteeMember[_committee[i]] = true;
        }
    }

    modifier onlyOwner()    { if (msg.sender != owner)    revert Unauthorized(); _; }
    modifier onlyAiOracle() {
        if (msg.sender != aiOracle && msg.sender != owner) revert Unauthorized();
        _;
    }


    function registerMarket(bytes32 marketId, address market) external onlyOwner {
        registeredMarkets[marketId] = market;
        emit MarketRegistered(marketId, market);
    }


    /**
     * @notice Committee member or owner proposes an outcome (multisig path).
     */
    function proposeResolution(
        bytes32 marketId,
        IMarket.OutcomeIndex outcome
    ) external {
        if (!isCommitteeMember[msg.sender] && msg.sender != owner)
            revert Unauthorized();
        _validateProposal(marketId);

        resolutions[marketId] = Resolution({
            outcome:    outcome,
            source:     ResolutionSource.MULTISIG,
            timestamp:  block.timestamp,
            resolvedBy: msg.sender,
            finalized:  false
        });

        emit ResolutionProposed(marketId, outcome, ResolutionSource.MULTISIG, "");
    }

    /**
     * @notice AI oracle (agent wallet) proposes resolution with on-chain reasoning.
     * @param rationale Human-readable explanation of the resolution logic.
     *                  Stored permanently in calldata / event logs.
     */
    function aiResolve(
        bytes32 marketId,
        IMarket.OutcomeIndex outcome,
        string calldata rationale
    ) external onlyAiOracle {
        if (outcome == IMarket.OutcomeIndex.INVALID) revert InvalidOutcome();
        _validateProposal(marketId);

        resolutions[marketId] = Resolution({
            outcome:    outcome,
            source:     ResolutionSource.AI_ORACLE,
            timestamp:  block.timestamp,
            resolvedBy: msg.sender,
            finalized:  false
        });

        emit ResolutionProposed(marketId, outcome, ResolutionSource.AI_ORACLE, rationale);
    }

    /**
     * @notice Anyone can trigger Chainlink-based resolution once a feed is configured.
     *         Compares latest answer against the stored target price.
     */
    function chainlinkResolve(bytes32 marketId) external {
        address feed = chainlinkFeeds[marketId];
        require(feed != address(0), "No Chainlink feed configured");
        _validateProposal(marketId);

        (, int256 answer,,,) = _chainlinkLatestRound(feed);
        int256 target = resolutionPrices[marketId];

        IMarket.OutcomeIndex outcome = (answer >= target)
            ? IMarket.OutcomeIndex.YES
            : IMarket.OutcomeIndex.NO;

        resolutions[marketId] = Resolution({
            outcome:    outcome,
            source:     ResolutionSource.CHAINLINK,
            timestamp:  block.timestamp,
            resolvedBy: msg.sender,
            finalized:  false
        });

        emit ResolutionProposed(marketId, outcome, ResolutionSource.CHAINLINK, "");
    }

    /**
     * @notice Finalizes a resolution once the dispute window has passed.
     *         Calls resolve() on the underlying PredictionMarket.
     *
     * AI_ORACLE resolutions have a 24h window; all others have 48h.
     */
    function finalizeResolution(bytes32 marketId) external {
        Resolution storage res = resolutions[marketId];
        require(!res.finalized,       "Already finalized");
        require(res.timestamp != 0,   "No resolution proposed");

        Dispute storage dis = disputes[marketId];
        if (dis.state == DisputeState.PENDING) revert DisputePeriodActive();

        uint256 window = (res.source == ResolutionSource.AI_ORACLE)
            ? DISPUTE_PERIOD / 2   // 24 h for AI oracle
            : DISPUTE_PERIOD;      // 48 h for multisig / Chainlink

        require(block.timestamp >= res.timestamp + window, "Dispute period still active");

        res.finalized = true;

        address marketAddr = registeredMarkets[marketId];
        require(marketAddr != address(0), "Market not registered");

        // Map IMarket.OutcomeIndex → bool for PredictionMarket.resolve(bool yesWon)
        bool yesWon = (res.outcome == IMarket.OutcomeIndex.YES);
        PredictionMarket(marketAddr).resolve(yesWon);

        emit ResolutionFinalized(marketId, res.outcome);
    }

    function raiseDispute(bytes32 marketId, string calldata reason) external {
        Resolution storage res = resolutions[marketId];
        require(res.timestamp != 0,  "No resolution to dispute");
        require(!res.finalized,      "Already finalized");
        require(block.timestamp < res.timestamp + DISPUTE_PERIOD, "Dispute window closed");
        if (disputes[marketId].state != DisputeState.NONE) revert AlreadyDisputed();

        IERC20(collateralToken).transferFrom(msg.sender, address(this), DISPUTE_BOND);

        disputes[marketId] = Dispute({
            challenger: msg.sender,
            bondAmount: DISPUTE_BOND,
            timestamp:  block.timestamp,
            state:      DisputeState.PENDING,
            reason:     reason
        });

        emit DisputeRaised(marketId, msg.sender, reason);
    }

    function voteOnDispute(bytes32 marketId, IMarket.OutcomeIndex vote) external {
        if (!isCommitteeMember[msg.sender]) revert NotCommitteeMember();
        Dispute storage dis = disputes[marketId];
        require(dis.state == DisputeState.PENDING, "Dispute not pending");
        if (committeeVotes[marketId][msg.sender] != IMarket.OutcomeIndex.INVALID)
            revert AlreadyVoted();

        committeeVotes[marketId][msg.sender] = vote;
        voteCount[marketId]++;

        emit CommitteeVote(marketId, msg.sender, vote);

        if (voteCount[marketId] >= COMMITTEE_QUORUM) {
            _resolveDispute(marketId);
        }
    }


    function setChainlinkFeed(bytes32 marketId, address feed, int256 targetPrice) external onlyOwner {
        chainlinkFeeds[marketId]   = feed;
        resolutionPrices[marketId] = targetPrice;
        emit ChainlinkFeedSet(marketId, feed, targetPrice);
    }

    function setAiOracle(address _oracle) external onlyOwner {
        aiOracle = _oracle;
    }

    function recoverBond(bytes32 marketId) external onlyOwner {
        Dispute storage dis = disputes[marketId];
        require(dis.state == DisputeState.NONE || dis.state == DisputeState.REJECTED, "Active dispute");
        if (dis.bondAmount > 0) {
            uint256 amt = dis.bondAmount;
            dis.bondAmount = 0;
            IERC20(collateralToken).transfer(owner, amt);
        }
    }

    function getResolution(bytes32 marketId) external view returns (Resolution memory) {
        return resolutions[marketId];
    }

    function getDispute(bytes32 marketId) external view returns (Dispute memory) {
        return disputes[marketId];
    }

    function _validateProposal(bytes32 marketId) internal view {
        if (registeredMarkets[marketId] == address(0)) revert MarketNotRegistered();
        if (resolutions[marketId].finalized)           revert AlreadyResolved();
    }

    function _resolveDispute(bytes32 marketId) internal {
        uint256 yesVotes = 0;
        for (uint256 i = 0; i < COMMITTEE_SIZE; i++) {
            if (committeeVotes[marketId][committee[i]] == IMarket.OutcomeIndex.YES)
                yesVotes++;
        }

        IMarket.OutcomeIndex committeeOutcome = (yesVotes >= COMMITTEE_QUORUM)
            ? IMarket.OutcomeIndex.YES
            : IMarket.OutcomeIndex.NO;

        Resolution storage res = resolutions[marketId];
        Dispute    storage dis = disputes[marketId];

        bool originalUpheld = (committeeOutcome == res.outcome);
        dis.state = originalUpheld ? DisputeState.REJECTED : DisputeState.UPHELD;

        if (!originalUpheld) {
            res.outcome = committeeOutcome;
            IERC20(collateralToken).transfer(dis.challenger, dis.bondAmount);
        } else {
            IERC20(collateralToken).transfer(owner, dis.bondAmount);
        }

        emit DisputeResolved(marketId, dis.state);
    }

    function _chainlinkLatestRound(address feed)
        internal view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        (bool ok, bytes memory data) = feed.staticcall(
            abi.encodeWithSignature("latestRoundData()")
        );
        require(ok, "Chainlink call failed");
        (roundId, answer, startedAt, updatedAt, answeredInRound) =
            abi.decode(data, (uint80, int256, uint256, uint256, uint80));
    }
}
