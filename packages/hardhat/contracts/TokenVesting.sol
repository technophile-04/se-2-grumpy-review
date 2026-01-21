// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract TokenVesting is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ Structs ============

    struct VestingSchedule {
        address beneficiary;
        uint256 totalAmount;
        uint256 releasedAmount;
        uint64 startTime;
        uint64 cliffDuration;
        uint64 vestingDuration;
        bool revocable;
        bool revoked;
    }

    // ============ State Variables ============

    IERC20 public immutable token;
    uint256 public scheduleCount;
    mapping(uint256 => VestingSchedule) public schedules;
    uint256 public totalVestingAmount;

    // ============ Events ============

    event VestingScheduleCreated(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 totalAmount,
        uint64 startTime,
        uint64 cliffDuration,
        uint64 vestingDuration,
        bool revocable
    );

    event TokensClaimed(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 amount
    );

    event VestingRevoked(
        uint256 indexed scheduleId,
        address indexed beneficiary,
        uint256 unvestedAmount
    );

    // ============ Errors ============

    error InvalidBeneficiary();
    error InvalidAmount();
    error InvalidDuration();
    error CliffExceedsDuration();
    error ScheduleNotFound();
    error NotBeneficiary();
    error NothingToClaim();
    error NotRevocable();
    error AlreadyRevoked();
    error NothingToRevoke();

    // ============ Constructor ============

    constructor(address _token) Ownable(msg.sender) {
        token = IERC20(_token);
    }

    // ============ Admin Functions ============

    /**
     * @notice Creates a new vesting schedule starting immediately
     * @param _beneficiary Address that will receive vested tokens
     * @param _totalAmount Total tokens to vest
     * @param _cliffDuration Seconds until first tokens vest
     * @param _vestingDuration Total vesting period in seconds
     * @param _revocable Whether admin can revoke unvested tokens
     */
    function createVestingSchedule(
        address _beneficiary,
        uint256 _totalAmount,
        uint64 _cliffDuration,
        uint64 _vestingDuration,
        bool _revocable
    ) external onlyOwner whenNotPaused returns (uint256 scheduleId) {
        if (_beneficiary == address(0)) revert InvalidBeneficiary();
        if (_totalAmount == 0) revert InvalidAmount();
        if (_vestingDuration == 0) revert InvalidDuration();
        if (_cliffDuration > _vestingDuration) revert CliffExceedsDuration();

        token.safeTransferFrom(msg.sender, address(this), _totalAmount);

        scheduleId = scheduleCount++;
        uint64 startTime = uint64(block.timestamp);

        schedules[scheduleId] = VestingSchedule({
            beneficiary: _beneficiary,
            totalAmount: _totalAmount,
            releasedAmount: 0,
            startTime: startTime,
            cliffDuration: _cliffDuration,
            vestingDuration: _vestingDuration,
            revocable: _revocable,
            revoked: false
        });

        totalVestingAmount += _totalAmount;

        emit VestingScheduleCreated(
            scheduleId,
            _beneficiary,
            _totalAmount,
            startTime,
            _cliffDuration,
            _vestingDuration,
            _revocable
        );
    }

    /**
     * @notice Revokes unvested tokens from a revocable schedule
     * @param _scheduleId The ID of the schedule to revoke
     * @dev Intentionally NOT marked whenNotPaused - allows admin to revoke during emergencies
     *      to recover unvested tokens. Beneficiaries can still claim vested portion after unpause.
     */
    function revokeVesting(uint256 _scheduleId) external onlyOwner {
        VestingSchedule storage schedule = schedules[_scheduleId];
        address beneficiary = schedule.beneficiary;

        if (beneficiary == address(0)) revert ScheduleNotFound();
        if (!schedule.revocable) revert NotRevocable();
        if (schedule.revoked) revert AlreadyRevoked();

        uint256 vestedAmount = _calculateVestedAmount(schedule);
        uint256 unvestedAmount = schedule.totalAmount - vestedAmount;

        if (unvestedAmount == 0) revert NothingToRevoke();

        schedule.revoked = true;
        schedule.totalAmount = vestedAmount;
        totalVestingAmount -= unvestedAmount;

        token.safeTransfer(owner(), unvestedAmount);

        emit VestingRevoked(_scheduleId, beneficiary, unvestedAmount);
    }

    /**
     * @notice Pauses all vesting operations (claims and new schedules)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Resumes vesting operations
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Beneficiary Functions ============

    /**
     * @notice Claims vested tokens for a schedule
     * @param _scheduleId The ID of the schedule to claim from
     */
    function claim(uint256 _scheduleId) external nonReentrant whenNotPaused {
        VestingSchedule storage schedule = schedules[_scheduleId];
        address beneficiary = schedule.beneficiary;

        if (beneficiary == address(0)) revert ScheduleNotFound();
        if (beneficiary != msg.sender) revert NotBeneficiary();

        uint256 claimableAmount = _calculateClaimableAmount(schedule);
        if (claimableAmount == 0) revert NothingToClaim();

        schedule.releasedAmount += claimableAmount;
        totalVestingAmount -= claimableAmount;

        token.safeTransfer(msg.sender, claimableAmount);

        emit TokensClaimed(_scheduleId, msg.sender, claimableAmount);
    }

    // ============ View Functions ============

    function getVestingSchedule(uint256 _scheduleId)
        external
        view
        returns (VestingSchedule memory)
    {
        return schedules[_scheduleId];
    }

    function getVestedAmount(uint256 _scheduleId) external view returns (uint256) {
        VestingSchedule storage schedule = schedules[_scheduleId];
        if (schedule.beneficiary == address(0)) revert ScheduleNotFound();
        return _calculateVestedAmount(schedule);
    }

    function getClaimableAmount(uint256 _scheduleId) external view returns (uint256) {
        VestingSchedule storage schedule = schedules[_scheduleId];
        if (schedule.beneficiary == address(0)) revert ScheduleNotFound();
        return _calculateClaimableAmount(schedule);
    }

    function getScheduleCount() external view returns (uint256) {
        return scheduleCount;
    }

    // ============ Internal Functions ============

    function _calculateVestedAmount(VestingSchedule storage schedule)
        internal
        view
        returns (uint256)
    {
        if (schedule.revoked) {
            return schedule.totalAmount;
        }

        uint64 currentTime = uint64(block.timestamp);
        uint64 startTime = schedule.startTime;
        uint64 cliffEnd = startTime + schedule.cliffDuration;
        uint64 vestingEnd = startTime + schedule.vestingDuration;

        if (currentTime < cliffEnd) {
            return 0;
        }

        if (currentTime >= vestingEnd) {
            return schedule.totalAmount;
        }

        uint256 timeVested = currentTime - startTime;
        return (schedule.totalAmount * timeVested) / schedule.vestingDuration;
    }

    function _calculateClaimableAmount(VestingSchedule storage schedule)
        internal
        view
        returns (uint256)
    {
        return _calculateVestedAmount(schedule) - schedule.releasedAmount;
    }
}
