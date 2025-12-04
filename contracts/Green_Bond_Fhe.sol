pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract GreenBondFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds;

    bool public paused;
    uint256 public currentBatchId;
    bool public batchOpen;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    // Project Data (Encrypted)
    struct ProjectData {
        euint32 totalInvestment;       // Encrypted total investment amount
        euint32 totalEnergyOutput;     // Encrypted total energy output (e.g., MWh)
        euint32 totalCo2Saved;         // Encrypted total CO2 saved (e.g., tons)
        euint32 totalRevenue;          // Encrypted total revenue generated
    }
    mapping(uint256 => ProjectData) public projectData; // batchId => ProjectData

    // Aggregated Report Data (Encrypted)
    struct AggregatedReport {
        euint32 totalInvestment;
        euint32 totalEnergyOutput;
        euint32 totalCo2Saved;
        euint32 totalRevenue;
        euint32 projectCount;
    }
    mapping(uint256 => AggregatedReport) public aggregatedReports; // batchId => AggregatedReport

    // Events
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event CooldownSecondsSet(uint256 oldCooldown, uint256 newCooldown);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event ProjectDataSubmitted(address indexed provider, uint256 indexed batchId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalInvestment, uint256 totalEnergyOutput, uint256 totalCo2Saved, uint256 totalRevenue, uint256 projectCount);

    // Custom Errors
    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error InvalidBatch();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        cooldownSeconds = 60; // Default cooldown of 60 seconds
        currentBatchId = 1;
        batchOpen = false;
        emit ProviderAdded(owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldown, newCooldownSeconds);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) {
            currentBatchId++;
        }
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchNotOpen();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitProjectData(
        uint256 _totalInvestment,
        uint256 _totalEnergyOutput,
        uint256 _totalCo2Saved,
        uint256 _totalRevenue
    ) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (!batchOpen) revert BatchNotOpen();

        lastSubmissionTime[msg.sender] = block.timestamp;

        ProjectData storage data = projectData[currentBatchId];
        _initIfNeeded(data.totalInvestment);
        _initIfNeeded(data.totalEnergyOutput);
        _initIfNeeded(data.totalCo2Saved);
        _initIfNeeded(data.totalRevenue);

        data.totalInvestment = data.totalInvestment.add(FHE.asEuint32(_totalInvestment));
        data.totalEnergyOutput = data.totalEnergyOutput.add(FHE.asEuint32(_totalEnergyOutput));
        data.totalCo2Saved = data.totalCo2Saved.add(FHE.asEuint32(_totalCo2Saved));
        data.totalRevenue = data.totalRevenue.add(FHE.asEuint32(_totalRevenue));

        AggregatedReport storage report = aggregatedReports[currentBatchId];
        _initIfNeeded(report.projectCount);
        report.projectCount = report.projectCount.add(FHE.asEuint32(1));

        emit ProjectDataSubmitted(msg.sender, currentBatchId);
    }

    function requestBatchReportDecryption(uint256 batchId) external whenNotPaused checkDecryptionCooldown {
        if (batchId == 0 || batchId > currentBatchId) revert InvalidBatch();
        if (batchOpen && batchId == currentBatchId) revert BatchNotOpen(); // Cannot decrypt open batch

        AggregatedReport storage report = aggregatedReports[batchId];
        _requireInitialized(report.totalInvestment);
        _requireInitialized(report.totalEnergyOutput);
        _requireInitialized(report.totalCo2Saved);
        _requireInitialized(report.totalRevenue);
        _requireInitialized(report.projectCount);

        euint32 memory totalInvestment = report.totalInvestment;
        euint32 memory totalEnergyOutput = report.totalEnergyOutput;
        euint32 memory totalCo2Saved = report.totalCo2Saved;
        euint32 memory totalRevenue = report.totalRevenue;
        euint32 memory projectCount = report.projectCount;

        bytes32[] memory cts = new bytes32[](5);
        cts[0] = FHE.toBytes32(totalInvestment);
        cts[1] = FHE.toBytes32(totalEnergyOutput);
        cts[2] = FHE.toBytes32(totalCo2Saved);
        cts[3] = FHE.toBytes32(totalRevenue);
        cts[4] = FHE.toBytes32(projectCount);

        bytes32 stateHash = _hashCiphertexts(cts);

        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        // @dev Replay protection: ensure this callback hasn't been processed for this requestId
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();

        // @dev State verification: ensure the contract state relevant to this decryption request hasn't changed
        // since the request was made. This prevents decrypting stale or inconsistent data.
        DecryptionContext memory context = decryptionContexts[requestId];
        AggregatedReport storage report = aggregatedReports[context.batchId];
        _requireInitialized(report.totalInvestment);
        _requireInitialized(report.totalEnergyOutput);
        _requireInitialized(report.totalCo2Saved);
        _requireInitialized(report.totalRevenue);
        _requireInitialized(report.projectCount);

        euint32 memory currentTotalInvestment = report.totalInvestment;
        euint32 memory currentTotalEnergyOutput = report.totalEnergyOutput;
        euint32 memory currentTotalCo2Saved = report.totalCo2Saved;
        euint32 memory currentTotalRevenue = report.totalRevenue;
        euint32 memory currentProjectCount = report.projectCount;

        bytes32[] memory currentCts = new bytes32[](5);
        currentCts[0] = FHE.toBytes32(currentTotalInvestment);
        currentCts[1] = FHE.toBytes32(currentTotalEnergyOutput);
        currentCts[2] = FHE.toBytes32(currentTotalCo2Saved);
        currentCts[3] = FHE.toBytes32(currentTotalRevenue);
        currentCts[4] = FHE.toBytes32(currentProjectCount);

        bytes32 currentHash = _hashCiphertexts(currentCts);
        if (currentHash != context.stateHash) revert StateMismatch();

        // @dev Proof verification: ensure the decryption proof is valid for the given requestId and cleartexts
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert InvalidProof();

        // Decode cleartexts
        uint256 totalInvestment = abi.decode(cleartexts, (uint256));
        cleartexts = cleartexts[32:];
        uint256 totalEnergyOutput = abi.decode(cleartexts, (uint256));
        cleartexts = cleartexts[32:];
        uint256 totalCo2Saved = abi.decode(cleartexts, (uint256));
        cleartexts = cleartexts[32:];
        uint256 totalRevenue = abi.decode(cleartexts, (uint256));
        cleartexts = cleartexts[32:];
        uint256 projectCount = abi.decode(cleartexts, (uint256));

        context.processed = true;
        decryptionContexts[requestId] = context; // Update storage

        emit DecryptionCompleted(requestId, context.batchId, totalInvestment, totalEnergyOutput, totalCo2Saved, totalRevenue, projectCount);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 storage val) internal {
        if (!FHE.isInitialized(val)) {
            val = FHE.asEuint32(0);
        }
    }

    function _requireInitialized(euint32 storage val) internal view {
        if (!FHE.isInitialized(val)) revert("FHEVarNotInitialized");
    }
}