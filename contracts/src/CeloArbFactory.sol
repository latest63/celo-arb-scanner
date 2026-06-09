// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ArbRouterImpl.sol";

/**
 * @title CeloArbFactory
 * @notice Deploys minimal proxy (EIP-1167) clones of ArbRouterImpl.
 *         Each user gets their own clone — fully isolated.
 */
contract CeloArbFactory {
    address public immutable implementation;
    address public immutable operator;

    // User => list of their agent contract addresses
    mapping(address => address[]) public userAgents;
    // agent => user (reverse lookup)
    mapping(address => address) public agentOwner;

    event AgentCreated(address indexed user, address indexed agent, uint256 index);

    constructor(address _implementation, address _operator) {
        implementation = _implementation;
        operator = _operator;
    }

    /// @notice Create a new agent clone for msg.sender
    /// @return agent Address of the deployed clone
    function createAgent() external returns (address agent) {
        // EIP-1167 minimal proxy
        bytes20 implBytes = bytes20(implementation);
        assembly {
            let clone := mload(0x40)
            mstore(clone, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(clone, 0x14), implBytes)
            mstore(add(clone, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            agent := create(0, clone, 0x37)
        }
        require(agent != address(0), "Clone failed");

        // Initialize: user owns it, factory operator executes trades
        ArbRouterImpl(agent).initialize(msg.sender, operator);

        userAgents[msg.sender].push(agent);
        agentOwner[agent] = msg.sender;
        emit AgentCreated(msg.sender, agent, userAgents[msg.sender].length - 1);
    }

    /// @notice Get all agent contracts for a user
    function getUserAgents(address user) external view returns (address[] memory) {
        return userAgents[user];
    }

    /// @notice Total agents created
    function totalAgents() external view returns (uint256) {
        return userAgents[msg.sender].length;
    }

    /// @notice Number of agents for a user
    function agentCount(address user) external view returns (uint256) {
        return userAgents[user].length;
    }
}
