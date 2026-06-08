// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ArbRouter
 * @notice Simple vault that holds capital and executes multi-hop arb swaps
 * @dev Only owner can trigger trades. Uniswap V3 integration on Celo.
 */
contract ArbRouter {
    address public owner;
    address public immutable SWAP_ROUTER;
    address public constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;
    address public constant USDm = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
    address public constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;

    event Deposited(address indexed token, uint256 amount);
    event Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event Withdrawn(address indexed token, uint256 amount, address to);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _swapRouter) {
        owner = msg.sender;
        SWAP_ROUTER = _swapRouter;
    }

    /// @notice Deposit tokens into the vault
    function deposit(address token, uint256 amount) external onlyOwner {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        emit Deposited(token, amount);
    }

    /// @notice Execute a single swap via Uniswap V3
    /// @param tokenIn Address of input token
    /// @param tokenOut Address of output token
    /// @param fee Pool fee tier (100, 500, 3000, 10000)
    /// @param amountIn Amount of tokenIn to swap
    /// @param amountOutMin Minimum amount of tokenOut to receive (slippage)
    /// @param sqrtPriceLimitX96 Price limit (0 for none)
    /// @return amountOut Actual amount received
    function swap(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMin,
        uint160 sqrtPriceLimitX96
    ) external onlyOwner returns (uint256 amountOut) {
        require(amountIn > 0, "Zero amount");

        // Approve router to spend our tokens
        IERC20(tokenIn).approve(SWAP_ROUTER, amountIn);

        // Prepare swap params for SwapRouter02.exactInputSingle
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: address(this),
            deadline: block.timestamp + 300,
            amountIn: amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        amountOut = ISwapRouter(SWAP_ROUTER).exactInputSingle(params);
        require(amountOut > 0, "Swap failed");

        emit Swapped(tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @notice Execute a multi-hop swap (triangular arb)
    /// @param path Encoded path: token0, fee, token1, fee, token2...
    /// @param amountIn Amount of input token
    /// @param amountOutMin Minimum output
    /// @return amountOut Actual output
    function swapMultiHop(
        bytes calldata path,
        uint256 amountIn,
        uint256 amountOutMin
    ) external onlyOwner returns (uint256 amountOut) {
        require(amountIn > 0, "Zero amount");

        // Extract first token from path for approval
        address tokenIn;
        assembly {
            tokenIn := calldataload(add(path.offset, 4)) // skip length, first 20 bytes
        }

        IERC20(tokenIn).approve(SWAP_ROUTER, amountIn);

        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: path,
            recipient: address(this),
            deadline: block.timestamp + 300,
            amountIn: amountIn,
            amountOutMinimum: amountOutMin
        });

        amountOut = ISwapRouter(SWAP_ROUTER).exactInput(params);
        require(amountOut > 0, "Multi-hop failed");

        emit Swapped(tokenIn, address(0), amountIn, amountOut);
    }

    /// @notice Withdraw tokens from vault
    function withdraw(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).transfer(to, amount);
        emit Withdrawn(token, amount, to);
    }

    /// @notice Check contract balance of a token
    function balanceOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}

// ── Minimal interfaces ──

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata params) external returns (uint256 amountOut);
}
