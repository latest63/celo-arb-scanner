// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ArbRouterImpl
 * @notice User-owned vault with operator execution. Each agent = one clone.
 *         User deposits tokens, operator executes arb trades.
 */
contract ArbRouterImpl {
    address public owner;
    address public operator;
    address public immutable SWAP_ROUTER;
    address public constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event OperatorChanged(address indexed oldOp, address indexed newOp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "Not operator");
        _;
    }

    /// @notice Constructor sets initial owner + operator. Called ONCE for the implementation.
    ///         Clones use initialize() instead.
    constructor(address _swapRouter) {
        SWAP_ROUTER = _swapRouter;
        owner = msg.sender;
        operator = msg.sender;
    }

    /// @notice Initialize clone. Called by factory after deployment.
    function initialize(address _owner, address _operator) external {
        require(owner == address(0), "Already init");
        require(_owner != address(0), "Zero owner");
        owner = _owner;
        operator = _operator;
    }

    /// @notice Deposit tokens into this contract (anyone can deposit to themselves)
    function deposit(address token, uint256 amount) external {
        require(amount > 0, "Zero amount");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Withdraw tokens (only owner)
    function withdraw(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).transfer(to, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    /// @notice Execute single swap (only operator)
    function swap(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMin,
        uint160 sqrtPriceLimitX96
    ) external onlyOperator returns (uint256 amountOut) {
        require(amountIn > 0, "Zero amount");
        IERC20(tokenIn).approve(SWAP_ROUTER, amountIn);

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

    /// @notice Multi-hop swap (only operator)
    function swapMultiHop(
        bytes calldata path,
        uint256 amountIn,
        uint256 amountOutMin
    ) external onlyOperator returns (uint256 amountOut) {
        require(amountIn > 0, "Zero amount");
        address tokenIn;
        assembly {
            tokenIn := calldataload(add(path.offset, 4))
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

    /// @notice Change operator (owner only)
    function setOperator(address newOperator) external onlyOwner {
        require(newOperator != address(0), "Zero address");
        emit OperatorChanged(operator, newOperator);
        operator = newOperator;
    }

    /// @notice Check token balance of this contract
    function balanceOf(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}

// ── Interfaces ──

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee;
        address recipient; uint256 deadline;
        uint256 amountIn; uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata) external returns (uint256);

    struct ExactInputParams {
        bytes path; address recipient;
        uint256 deadline; uint256 amountIn; uint256 amountOutMinimum;
    }
    function exactInput(ExactInputParams calldata) external returns (uint256);
}
