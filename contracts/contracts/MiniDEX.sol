// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @notice Teaching AMM: constant product pools, 0.3% LP fees and transferable NFT positions.
/// @dev Standard, non-rebasing, non-fee-on-transfer ERC20 tokens only. Each pool is accounted separately.
contract MiniDEX is ERC721Enumerable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant FEE_BPS = 30;
    uint256 public constant BPS = 10_000;
    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    uint256 public poolCount;
    uint256 public nextPositionId = 1;

    struct Pool {
        address tokenA;
        address tokenB;
        uint256 reserveA;
        uint256 reserveB;
        uint256 totalShares;
        uint256 createdAt;
    }
    struct Position {
        uint256 poolId;
        uint256 shares;
        uint256 depositedA;
        uint256 depositedB;
        uint256 createdAt;
        address provider;
    }
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => Position) public positions;
    mapping(bytes32 => uint256) private pairIds;
    mapping(uint256 => uint256[]) private poolPositionIds;
    mapping(address => uint256) public accountedBalances;

    event PoolCreated(uint256 indexed poolId, address indexed tokenA, address indexed tokenB);
    event LiquidityAdded(uint256 indexed poolId, uint256 indexed tokenId, address indexed provider, uint256 amountA, uint256 amountB, uint256 shares);
    event LiquidityRemoved(uint256 indexed poolId, uint256 indexed tokenId, address indexed owner, uint256 amountA, uint256 amountB, uint256 shares);
    event Swap(uint256 indexed poolId, address indexed trader, address indexed tokenIn, uint256 amountIn, uint256 amountOut, uint256 feeAmount);

    constructor() ERC721("MiniDEX Liquidity Position", "MDLP") {}
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Position storage pos = positions[tokenId];
        string memory json = string.concat(
            '{"name":"MiniDEX Position #', Strings.toString(tokenId),
            '","description":"Full-range constant-product LP position. Fees compound in pool reserves.",',
            '"poolId":"', Strings.toString(pos.poolId),
            '","shares":"', Strings.toString(pos.shares),
            '","depositedA":"', Strings.toString(pos.depositedA),
            '","depositedB":"', Strings.toString(pos.depositedB),
            '","createdAt":"', Strings.toString(pos.createdAt),
            '","provider":"', Strings.toHexString(pos.provider), '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
    modifier beforeDeadline(uint256 deadline) {
        require(block.timestamp <= deadline, "Expired");
        _;
    }

    function getPoolId(address tokenX, address tokenY) public view returns (uint256) {
        (address a, address b) = _sort(tokenX, tokenY);
        return pairIds[keccak256(abi.encode(a, b))];
    }
    function createPool(address tokenX, address tokenY) external returns (uint256 poolId) {
        (address a, address b) = _sort(tokenX, tokenY);
        require(a.code.length > 0 && b.code.length > 0, "Not token contracts");
        bytes32 key = keccak256(abi.encode(a, b));
        require(pairIds[key] == 0, "Pool exists");
        poolId = ++poolCount;
        pools[poolId] = Pool(a, b, 0, 0, 0, block.timestamp);
        pairIds[key] = poolId;
        emit PoolCreated(poolId, a, b);
    }
    function getPoolPositionIds(uint256 poolId) external view returns (uint256[] memory) {
        _pool(poolId);
        return poolPositionIds[poolId]; // historical ids; burned positions have zero shares
    }
    function getAmountOut(uint256 poolId, address tokenIn, uint256 amountIn) public view returns (uint256) {
        Pool storage p = _pool(poolId);
        require(tokenIn == p.tokenA || tokenIn == p.tokenB, "Invalid token");
        require(amountIn > 0, "Zero input");
        (uint256 reserveIn, uint256 reserveOut) = tokenIn == p.tokenA ? (p.reserveA, p.reserveB) : (p.reserveB, p.reserveA);
        require(reserveIn > 0 && reserveOut > 0, "Empty pool");
        uint256 withFee = amountIn * (BPS - FEE_BPS);
        return Math.mulDiv(withFee, reserveOut, reserveIn * BPS + withFee);
    }
    /// @notice Desired/minimum amounts follow the pool's sorted tokenA/tokenB order.
    function addLiquidity(uint256 poolId, uint256 desiredA, uint256 desiredB, uint256 minA, uint256 minB, uint256 deadline)
        external nonReentrant beforeDeadline(deadline) returns (uint256 tokenId, uint256 shares)
    {
        Pool storage p = _pool(poolId);
        require(desiredA > 0 && desiredB > 0, "Zero amount");
        uint256 amountA = desiredA;
        uint256 amountB = desiredB;
        if (p.totalShares == 0) {
            uint256 root = Math.sqrt(amountA * amountB);
            require(root > MINIMUM_LIQUIDITY, "Initial liquidity too small");
            shares = root - MINIMUM_LIQUIDITY;
            p.totalShares = MINIMUM_LIQUIDITY;
        } else {
            uint256 optimalB = Math.mulDiv(desiredA, p.reserveB, p.reserveA);
            if (optimalB <= desiredB) amountB = optimalB;
            else amountA = Math.mulDiv(desiredB, p.reserveA, p.reserveB);
            shares = Math.min(Math.mulDiv(amountA, p.totalShares, p.reserveA), Math.mulDiv(amountB, p.totalShares, p.reserveB));
        }
        require(shares > 0 && amountA > 0 && amountB > 0, "Zero shares");
        require(amountA >= minA && amountB >= minB, "Liquidity slippage");
        _pull(p.tokenA, msg.sender, amountA);
        _pull(p.tokenB, msg.sender, amountB);
        p.reserveA += amountA;
        p.reserveB += amountB;
        p.totalShares += shares;
        accountedBalances[p.tokenA] += amountA;
        accountedBalances[p.tokenB] += amountB;
        tokenId = nextPositionId++;
        positions[tokenId] = Position(poolId, shares, amountA, amountB, block.timestamp, msg.sender);
        poolPositionIds[poolId].push(tokenId);
        _safeMint(msg.sender, tokenId);
        emit LiquidityAdded(poolId, tokenId, msg.sender, amountA, amountB, shares);
    }
    function previewRemove(uint256 tokenId) public view returns (uint256 amountA, uint256 amountB) {
        Position storage pos = positions[tokenId];
        require(pos.shares > 0, "Inactive position");
        Pool storage p = pools[pos.poolId];
        amountA = Math.mulDiv(pos.shares, p.reserveA, p.totalShares);
        amountB = Math.mulDiv(pos.shares, p.reserveB, p.totalShares);
    }
    function removeLiquidity(uint256 tokenId, uint256 minA, uint256 minB, uint256 deadline)
        external nonReentrant beforeDeadline(deadline) returns (uint256 amountA, uint256 amountB)
    {
        require(ownerOf(tokenId) == msg.sender, "Not position owner");
        Position memory pos = positions[tokenId];
        (amountA, amountB) = previewRemove(tokenId);
        require(amountA >= minA && amountB >= minB, "Withdrawal slippage");
        Pool storage p = pools[pos.poolId];
        p.reserveA -= amountA;
        p.reserveB -= amountB;
        p.totalShares -= pos.shares;
        accountedBalances[p.tokenA] -= amountA;
        accountedBalances[p.tokenB] -= amountB;
        delete positions[tokenId];
        _burn(tokenId);
        IERC20(p.tokenA).safeTransfer(msg.sender, amountA);
        IERC20(p.tokenB).safeTransfer(msg.sender, amountB);
        emit LiquidityRemoved(pos.poolId, tokenId, msg.sender, amountA, amountB, pos.shares);
    }
    function swap(uint256 poolId, address tokenIn, uint256 amountIn, uint256 amountOutMin, uint256 deadline)
        external nonReentrant beforeDeadline(deadline) returns (uint256 amountOut)
    {
        Pool storage p = _pool(poolId);
        amountOut = getAmountOut(poolId, tokenIn, amountIn);
        require(amountOut > 0 && amountOut >= amountOutMin, "Swap slippage");
        address tokenOut = tokenIn == p.tokenA ? p.tokenB : p.tokenA;
        _pull(tokenIn, msg.sender, amountIn);
        if (tokenIn == p.tokenA) { p.reserveA += amountIn; p.reserveB -= amountOut; }
        else { p.reserveB += amountIn; p.reserveA -= amountOut; }
        accountedBalances[tokenIn] += amountIn;
        accountedBalances[tokenOut] -= amountOut;
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        emit Swap(poolId, msg.sender, tokenIn, amountIn, amountOut, Math.mulDiv(amountIn, FEE_BPS, BPS));
    }
    function _pull(address token, address from, uint256 amount) private {
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(from, address(this), amount);
        require(IERC20(token).balanceOf(address(this)) - beforeBalance == amount, "Unsupported token behavior");
    }
    function _pool(uint256 poolId) private view returns (Pool storage p) {
        require(poolId > 0 && poolId <= poolCount, "Unknown pool");
        p = pools[poolId];
    }
    function _sort(address x, address y) private pure returns (address a, address b) {
        require(x != address(0) && y != address(0) && x != y, "Invalid pair");
        (a, b) = x < y ? (x, y) : (y, x);
    }
}
