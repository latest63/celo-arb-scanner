// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ArbRouter.sol";

contract Deploy is Script {
    // Uniswap V3 SwapRouter02 on Celo mainnet
    address constant SWAP_ROUTER = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        ArbRouter router = new ArbRouter(SWAP_ROUTER);

        vm.stopBroadcast();

        console2.log("ArbRouter deployed at:");
        console2.log(vm.toString(address(router)));
        console2.log("SwapRouter:", vm.toString(SWAP_ROUTER));
    }
}
