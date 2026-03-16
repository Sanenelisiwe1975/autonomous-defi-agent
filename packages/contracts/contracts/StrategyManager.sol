// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract StrategyManager {
    enum BundleType { ENTER_LONG, EXIT, LP_DEPLOY, LP_RECALL, REBALANCE, CLAIM}

    struct StrategyBundle {
        BundleType  bundleType;
        bytes32     marketIdA;
        bytes32     marketIdB;
        address     marketAdrrA;
        address     marketAdrrB;
        address     collateralToken;
        uint256     amount;
        IMarket.OutcomeIndex outcomeA;
        IMarket.OutcomeIndex outcomeB;
        uint256     minOut;          
        uint256     deadline;      
        uint256     nonce;   
    }

    strut StrategyRecord{
        uint256  totalDeployed;
        uint256  totalReturned;
        uint256  executionCount;
        uint256  lastExecuted;
    }

    AgentVault public immutable vault:
    address    public agentKey;
    address    public owner;

    mapping(address => bool)   public approvedExecutors;
    mapping (uint256 => bool)  public usedNonces;
    mapping(bytes => StrategyRecord) public strategyRecords;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant BUNDLE_TYPEHASH = keccak256(
        "StrategyBundle(uint8 bundleType,bytes32 marketIdA,bytes32 marketIdB,"
        "address marketAddrA,address marketAddrB,address collateralToken,"
        "uint256 amount,uint8 outcomeA,uint8 outcomeB,uint256 minOut,"
        "uint256 deadline,uint256 nonce)"
    );


    event BundleExecuted(BundleType bundleType, bytes32 marketIdA, bytes32 marketIdB, uint256 amount);
    event AgentKeyRotated(address newKey);
    event ExecutorSet(address executor, bool approved);

    error Unauthorized();
    error BundleExpired();
    error NonceUsed();
    error InvalidSignature();
    error InvalidBundle();

    constructor(address _vault, address _agentKey) {
        vault    = AgentVault(_vault);
        agentKey = _agentKey;
        owner    = msg.sender;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("StrategyManager"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }


    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }

   
    function executeBundle(
        StrategyBundle calldata bundle,
        bytes          calldata signature
    ) external {
        if (!approvedExecutors[msg.sender] && msg.sender != agentKey) revert Unauthorized();
        if (block.timestamp > bundle.deadline) revert BundleExpired();
        if (usedNonces[bundle.nonce])          revert NonceUsed();

        _verifySignature(bundle, signature);

        usedNonces[bundle.nonce] = true;

        if      (bundle.bundleType == BundleType.ENTER_LONG) _enterLong(bundle);
        else if (bundle.bundleType == BundleType.EXIT)        _exit(bundle);
        else if (bundle.bundleType == BundleType.LP_DEPLOY)   _lpDeploy(bundle);
        else if (bundle.bundleType == BundleType.LP_RECALL)   _lpRecall(bundle);
        else if (bundle.bundleType == BundleType.REBALANCE)   _rebalance(bundle);
        else if (bundle.bundleType == BundleType.CLAIM)       _claim(bundle);
        else revert InvalidBundle();

        StrategyRecord storage rec = strategyRecords[bundle.marketIdA];
        rec.totalDeployed += bundle.amount;
        rec.executionCount++;
        rec.lastExecuted = block.timestamp;

        emit BundleExecuted(bundle.bundleType, bundle.marketIdA, bundle.marketIdB, bundle.amount);
    }

    function directExecute(StrategyBundle calldata bundle) external {
        if (msg.sender != agentKey) revert Unauthorized();
        if (block.timestamp > bundle.deadline) revert BundleExpired();
        if (usedNonces [bundle.nonce])   revert NonceUsed();
        usedNonces[bundle.nonce] = true;

        if      (bundle.bundleType == BundleType.ENTER_LONG) _enterLong(bundle);
        else if (bundle.bundleType == BundleType.EXIT)        _exit(bundle);
        else if (bundle.bundleType == BundleType.LP_DEPLOY)   _lpDeploy(bundle);
        else if (bundle.bundleType == BundleType.LP_RECALL)   _lpRecall(bundle);
        else if (bundle.bundleType == BundleType.REBALANCE)   _rebalance(bundle);
        else if (bundle.bundleType == BundleType.CLAIM)       _claim(bundle);
        else revert InvalidBundle();

        emit BundleExecuted(bundle.bundleType, bundle.marketIdA, bundle.marketIdB, bundle.amount); 
        
    }

    function _enterLong(StrategyBundle calldata b) internal {
        vault.deployCapital(
            b.marketIdA, b.marketAddrA, b.collateralToken,
            b.amount, b.outcomeA, b.minOut
        );
    }

    function _exit(StrategyBundle calldata b) internal {
        vault.withdrawCapital(b.marketIdA, b.outcomeA, b.amount, b.minOut);
    }

    function _lpDeploy(StrategyBundle calldata b) internal {
        vault.provideLiquidity(
            b.marketIdA, b.marketAddrA, b.collateralToken, b.amount, b.minOut
        );
    }

    function _lpRecall(StrategyBundle calldata b) internal {
        // b.amount = lpShares to recall
        vault.withdrawLiquidity(b.marketIdA, b.amount, b.minOut);
    }

    function _rebalance(StrategyBundle calldata b) internal {
        // Step 1: exit position in market A
        vault.withdrawCapital(b.marketIdA, b.outcomeA, b.amount, 0);
        // Step 2: re-deploy proceeds into market B
        // Note: actual collateral received from step 1 is used; minOut applied here
        vault.deployCapital(
            b.marketIdB, b.marketAddrB, b.collateralToken,
            b.amount, b.outcomeB, b.minOut
        );
    

    function _claim(StrategyBundle calldata b) internal {
        uint256 payout = vault.claimWinnings(b.marketIdA);
        strategyRecords[b.marketIdA].totalReturned += payout;
    }

    function _verifySignature(StrategyBundle calldata bundle, bytes calldata sig) internal view {
        bytes32 structHash = keccak256(abi.encode(
            BUNDLE_TYPEHASH,
            uint8(bundle.bundleType),
            bundle.marketIdA,
            bundle.marketIdB,
            bundle.marketAddrA,
            bundle.marketAddrB,
            bundle.collateralToken,
            bundle.amount,
            uint8(bundle.outcomeA),
            uint8(bundle.outcomeB),
            bundle.minOut,
            bundle.deadline,
            bundle.nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        address recovered = _recoverSigner(digest, sig);
        if (recovered != agentKey) revert InvalidSignature();
    }

    function _recoverSigner(bytes32 digest, bytes calldata sig)
        internal pure returns (address)
    {
        require(sig.length == 65, "Bad sig length");
        bytes32 r;
        bytes32 s;
        uint8   v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(digest, v, r, s);
    }


    function rotateAgentKey(address newKey) external onlyOwner {
        agentKey = newKey;
        emit AgentKeyRotated(newKey);
    }

    function setExecutor(address executor, bool approved) external onlyOwner {
        approvedExecutors[executor] = approved;
        emit ExecutorSet(executor, approved);
    }

    function getStrategyRecord(bytes32 marketId) external view returns (StrategyRecord memory) {
        return strategyRecords[marketId];
    }
}


}