// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ArbRouterImpl.sol";
import "../src/CeloArbFactory.sol";

contract DeployFactory is Script {
    // Uniswap V3 SwapRouter02 on Celo mainnet
    address constant SWAP_ROUTER = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);

        // 1. Deploy implementation
        ArbRouterImpl impl = new ArbRouterImpl(SWAP_ROUTER);
        console2.log("ArbRouterImpl:", vm.toString(address(impl)));

        // 2. Deploy factory (operator = deployer)
        CeloArbFactory factory = new CeloArbFactory(address(impl), deployer);
        console2.log("CeloArbFactory:", vm.toString(address(factory)));

        vm.stopBroadcast();

        console2.log("---");
        console2.log("Factory creates clones with:");
        console2.log("  Owner   = user (msg.sender)");
        console2.log("  Operator =", vm.toString(deployer));
        console2.log("To verify:");
        console2.log("  forge verify-contract <addr> src/ArbRouterImpl.sol:ArbRouterImpl --chain celo");
        console2.log("  forge verify-contract <addr> src/CeloArbFactory.sol:CeloArbFactory --chain celo");
    }
}
