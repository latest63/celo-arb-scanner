#!/usr/bin/env python3
"""
Celo Cross-Stable Triangular Arbitrage Scanner
Tracks live rates across Mento, Uniswap V3, and Carbon DeFi
Focus: local-currency stables (KESm, NGNm, GHSm, etc.) + stable triangles
"""

import json
import time
import requests
from web3 import Web3
from typing import Dict, List, Tuple
from dataclasses import dataclass
from datetime import datetime

# ── RPC ──
CELO_RPC = "https://forno.celo.org"
w3 = Web3(Web3.HTTPProvider(CELO_RPC))

# ── Contract Addresses (Mainnet) ──

# Mento V3
MENTO_ROUTER = Web3.to_checksum_address("0x4861840C2EfB2b98312B0aE34d86fD73E8f9B6f6")
MENTO_FPMM_FACTORY = Web3.to_checksum_address("0xa849b475FE5a4B5C9C3280152c7a1945b907613b")

# Mento V2
MENTO_BROKER = Web3.to_checksum_address("0x777A8255cA72412f0d706dc03C9D1987306B4CaD")
MENTO_BIPOOL = Web3.to_checksum_address("0x22d9db95E6Ae61c104A7B6F6C78D7993B94ec901")

# Uniswap V3
UNI_V3_FACTORY = Web3.to_checksum_address("0xAfE208a311B21f13EF87E33A90049fC17A7acDEc")
UNI_QUOTER = Web3.to_checksum_address("0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8")

# Tokens of interest (local-currency stables + major stables)
TOKENS = {
    "USDm":  Web3.to_checksum_address("0x765DE816845861e75A25fCA122bb6898B8B1282a"),
    "EURm":  Web3.to_checksum_address("0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73"),
    "BRLm":  Web3.to_checksum_address("0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787"),
    "KESm":  Web3.to_checksum_address("0x456a3D042C0DbD3db53D5489e98dFb038553B0d0"),
    "NGNm":  Web3.to_checksum_address("0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71"),
    "GHSm":  Web3.to_checksum_address("0xfAeA5F3404bbA20D3cc2f8C4B0A888F55a3c7313"),
    "XOFm":  Web3.to_checksum_address("0x73F93dcc49cB8A239e2032663e9475dd5ef29A08"),
    "ZARm":  Web3.to_checksum_address("0x4c35853A3B4e647fD266f4de678dCc8fEC410BF6"),
    "PHPm":  Web3.to_checksum_address("0x105d4A9306D2E55a71d2Eb95B81553AE1dC20d7B"),
    "GBPm":  Web3.to_checksum_address("0xCCF663b1fF11028f0b19058d0f7B674004a40746"),
    "USDC":  Web3.to_checksum_address("0xcebA9300f2b948710d2653dD7B07f33A8B32118C"),
    "USDT":  Web3.to_checksum_address("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"),
}

# Known Mento FPMM pools
MENTO_POOLS = {
    "USDC/USDm": Web3.to_checksum_address("0x462fe04b4FD719Cbd04C0310365D421D02AaA19E"),
    "USDT/USDm": Web3.to_checksum_address("0x0FEBa760d93423D127DE1B6ABECdB60E5253228D"),
    "GBPm/USDm": Web3.to_checksum_address("0x8C0014afe032E4574481D8934504100bF23fCB56"),
}

# ── Minimal ABIs ──

ERC20_ABI = [
    {"constant": True, "inputs": [], "name": "decimals", "outputs": [{"name": "", "type": "uint8"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "symbol", "outputs": [{"name": "", "type": "string"}], "type": "function"},
]

# Uniswap V3 QuoterV2 ABI (just quoteExactInputSingle)
QUOTER_ABI = [
    {
        "inputs": [{
            "components": [
                {"name": "tokenIn", "type": "address"},
                {"name": "tokenOut", "type": "address"},
                {"name": "amountIn", "type": "uint256"},
                {"name": "fee", "type": "uint24"},
                {"name": "sqrtPriceLimitX96", "type": "uint160"},
            ],
            "name": "params",
            "type": "tuple"
        }],
        "name": "quoteExactInputSingle",
        "outputs": [
            {"name": "amountOut", "type": "uint256"},
            {"name": "sqrtPriceX96After", "type": "uint160"},
            {"name": "initializedTicksCrossed", "type": "uint32"},
            {"name": "gasEstimate", "type": "uint256"},
        ],
        "stateMutability": "view",
        "type": "function"
    }
]

# Mento FPMM Router ABI (getAmountsOut)
ROUTER_ABI = [
    {
        "inputs": [
            {"name": "amountIn", "type": "uint256"},
            {"name": "path", "type": "address[]"},
        ],
        "name": "getAmountsOut",
        "outputs": [{"name": "amounts", "type": "uint256[]"}],
        "stateMutability": "view",
        "type": "function"
    }
]

# Mento V2 BiPoolManager ABI (just getAmountsOut)
BIPOOL_ABI = [
    {
        "inputs": [
            {"name": "_exchangeId", "type": "bytes32"},
            {"name": "amountIn", "type": "uint256"},
            {"name": "sellingCelo", "type": "bool"},
        ],
        "name": "getAmountOut",
        "outputs": [
            {"name": "amountOut", "type": "uint256"},
            {"name": "updatedBucket", "type": "uint256"},
        ],
        "stateMutability": "view",
        "type": "function"
    }
]

# Mento V2 Broker ABI
BROKER_ABI = [
    {
        "inputs": [
            {"name": "exchangeProvider", "type": "address"},
            {"name": "exchangeId", "type": "bytes32"},
        ],
        "name": "getExchange",
        "outputs": [{"name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function"
    }
]


@dataclass
class RateSnapshot:
    timestamp: float
    source: str
    pair: str
    rate: float  # tokenOut per tokenIn


def get_token_decimals(address) -> int:
    """Get decimals for a token address."""
    contract = w3.eth.contract(address=address, abi=ERC20_ABI)
    try:
        return contract.functions.decimals().call()
    except:
        return 18  # default


def get_token_symbol(address) -> str:
    """Get symbol for a token address."""
    contract = w3.eth.contract(address=address, abi=ERC20_ABI)
    try:
        return contract.functions.symbol().call()
    except:
        return address[:10]


def query_uniswap_v3(token_in: str, token_out: str, amount_in: int, fee: int = 3000) -> float:
    """Get swap rate from Uniswap V3 QuoterV2."""
    try:
        quoter = w3.eth.contract(address=UNI_QUOTER, abi=QUOTER_ABI)
        result = quoter.functions.quoteExactInputSingle({
            "tokenIn": Web3.to_checksum_address(token_in),
            "tokenOut": Web3.to_checksum_address(token_out),
            "amountIn": amount_in,
            "fee": fee,
            "sqrtPriceLimitX96": 0,
        }).call()
        return result[0] / amount_in
    except Exception as e:
        return 0.0


def query_mento_v3(token_in: str, token_out: str, amount_in: int) -> float:
    """Get swap rate from Mento V3 FPMM Router."""
    try:
        router = w3.eth.contract(address=MENTO_ROUTER, abi=ROUTER_ABI)
        result = router.functions.getAmountsOut(
            amount_in,
            [Web3.to_checksum_address(token_in), Web3.to_checksum_address(token_out)]
        ).call()
        return result[-1] / amount_in
    except Exception as e:
        return 0.0


def discover_mento_v2_pools() -> Dict[str, bytes]:
    """
    Discover Mento V2 exchange IDs from the Broker.
    Known exchange IDs for common stable pairs.
    """
    # For now, use known exchange IDs
    # In production, query Broker.getExchange() for each stable
    return {}


def scan_pair(token_a: str, token_b: str, amount: int) -> List[RateSnapshot]:
    """Scan a single pair across all sources."""
    rates = []
    sym_a = get_token_symbol(token_a)
    sym_b = get_token_symbol(token_b)
    pair = f"{sym_a}/{sym_b}"

    # Uniswap V3 (try multiple fee tiers)
    for fee in [100, 500, 3000]:
        rate = query_uniswap_v3(token_a, token_b, amount, fee)
        if rate > 0:
            rates.append(RateSnapshot(
                timestamp=time.time(),
                source=f"UniswapV3-{fee}bps",
                pair=pair,
                rate=rate,
            ))

    # Mento V3 FPMM
    rate = query_mento_v3(token_a, token_b, amount)
    if rate > 0:
        rates.append(RateSnapshot(
            timestamp=time.time(),
            source="MentoV3",
            pair=pair,
            rate=rate,
        ))

    return rates


def find_triangular_arb(rates_a: List[RateSnapshot], rates_b: List[RateSnapshot],
                         rates_c: List[RateSnapshot]) -> List[dict]:
    """
    Find triangular arb opportunities.
    Triangle: A → B → C → (back to A)
    Profitable when rate_A→B * rate_B→C * rate_C→A > 1
    """
    opportunities = []

    for ra in rates_a:
        for rb in rates_b:
            for rc in rates_c:
                product = ra.rate * rb.rate * rc.rate
                if product > 1.0:
                    spread_pct = (product - 1.0) * 100
                    opportunities.append({
                        "triangle": f"{ra.pair.split('/')[0]} → {ra.pair.split('/')[1]} → {rc.pair.split('/')[0]}",
                        "legs": [
                            f"{ra.source}: {ra.pair} @ {ra.rate:.6f}",
                            f"{rb.source}: {rb.pair} @ {rb.rate:.6f}",
                            f"{rc.source}: {rc.pair} @ {rc.rate:.6f}",
                        ],
                        "product": product,
                        "spread_pct": spread_pct,
                        "routes": f"{ra.source} → {rb.source} → {rc.source}",
                    })

    return sorted(opportunities, key=lambda x: x["spread_pct"], reverse=True)


def main():
    print("=" * 80)
    print(f"CELO CROSS-STABLE ARBITRAGE SCANNER")
    print(f"Block: {w3.eth.block_number}")
    print(f"Time: {datetime.now().isoformat()}")
    print("=" * 80)

    # Define base amount for quotes (1 unit in 18 decimals = 10^18)
    BASE_AMOUNT = 10 ** 18  # 1 unit for 18-decimal tokens
    BASE_AMOUNT_6 = 10 ** 6  # 1 unit for 6-decimal tokens (USDC/USDT)

    # ── Step 1: Scan all local-currency stables vs USDm ──
    print("\n📊 LOCAL-CURRENCY STABLE RATES vs USDm")
    print("-" * 60)

    local_stables = ["KESm", "NGNm", "GHSm", "ZARm", "PHPm", "XOFm", "BRLm"]
    usdm = TOKENS["USDm"]

    for sym in local_stables:
        addr = TOKENS[sym]
        rates = scan_pair(addr, usdm, BASE_AMOUNT)
        for r in rates:
            inverse = 1 / r.rate if r.rate > 0 else 0
            print(f"  {sym}→USDm [{r.source:20s}]: 1 {sym} = {r.rate:.8f} USDm  (1 USDm = {inverse:.2f} {sym})")

        # Also scan reverse
        rates_rev = scan_pair(usdm, addr, BASE_AMOUNT)
        for r in rates_rev:
            print(f"  USDm→{sym} [{r.source:20s}]: 1 USDm = {r.rate:.8f} {sym}")

    # ── Step 2: Cross-stable pairs (EURm, GBPm vs USDm) ──
    print("\n📊 CROSS-STABLE RATES")
    print("-" * 60)

    cross_stables = ["EURm", "GBPm"]
    for sym in cross_stables:
        addr = TOKENS[sym]
        rates = scan_pair(addr, usdm, BASE_AMOUNT)
        for r in rates:
            print(f"  {sym}→USDm [{r.source:20s}]: 1 {sym} = {r.rate:.8f} USDm")

    # ── Step 3: Triangular arb detection ──
    print("\n🔺 TRIANGULAR ARB SCAN")
    print("-" * 60)

    # Triangle: EURm → USDm → USDC → EURm
    print("\n  Triangle 1: EURm → USDm → USDC → EURm")
    eur_usdm = scan_pair(TOKENS["EURm"], usdm, BASE_AMOUNT)
    usdm_usdc = scan_pair(usdm, TOKENS["USDC"], BASE_AMOUNT)
    usdc_eur = scan_pair(TOKENS["USDC"], TOKENS["EURm"], BASE_AMOUNT_6)

    if eur_usdm and usdm_usdc and usdc_eur:
        opps = find_triangular_arb(eur_usdm, usdm_usdc, usdc_eur)
        if opps:
            for o in opps[:5]:
                print(f"  ✅ SPREAD: {o['spread_pct']:.4f}%  |  {o['triangle']}")
                for leg in o['legs']:
                    print(f"     {leg}")
        else:
            print("  ❌ No profitable triangles found")

    # Triangle: NGNm → USDm → KESm → NGNm
    print("\n  Triangle 2: NGNm → USDm → KESm → NGNm")
    ngn_usdm = scan_pair(TOKENS["NGNm"], usdm, BASE_AMOUNT)
    usdm_kes = scan_pair(usdm, TOKENS["KESm"], BASE_AMOUNT)
    kes_ngn = scan_pair(TOKENS["KESm"], TOKENS["NGNm"], BASE_AMOUNT)

    if ngn_usdm and usdm_kes and kes_ngn:
        opps = find_triangular_arb(ngn_usdm, usdm_kes, kes_ngn)
        if opps:
            for o in opps[:5]:
                print(f"  ✅ SPREAD: {o['spread_pct']:.4f}%  |  {o['triangle']}")
        else:
            print("  ❌ No profitable triangles found")

    # Triangle: KESm → USDm → GHSm → KESm
    print("\n  Triangle 3: KESm → USDm → GHSm → KESm")
    kes_usdm = scan_pair(TOKENS["KESm"], usdm, BASE_AMOUNT)
    usdm_ghs = scan_pair(usdm, TOKENS["GHSm"], BASE_AMOUNT)
    ghs_kes = scan_pair(TOKENS["GHSm"], TOKENS["KESm"], BASE_AMOUNT)

    if kes_usdm and usdm_ghs and ghs_kes:
        opps = find_triangular_arb(kes_usdm, usdm_ghs, ghs_kes)
        if opps:
            for o in opps[:5]:
                print(f"  ✅ SPREAD: {o['spread_pct']:.4f}%  |  {o['triangle']}")
        else:
            print("  ❌ No profitable triangles found")

    # ── Step 4: Mento oracle vs DEX comparison ──
    print("\n📊 MENTO ORACLE vs DEX PRICE COMPARISON")
    print("-" * 60)
    print("  (Oracle peg = 1:1 for stable pairs)")
    print("  If DEX price deviates from oracle peg, arb opportunity exists\n")

    for pool_name, pool_addr in MENTO_POOLS.items():
        print(f"  Pool: {pool_name} ({pool_addr})")
        # The FPMM pool price is the Mento rate
        # Compare to Uniswap V3 price for same pair
        tokens = pool_name.split("/")
        t_a = TOKENS[tokens[0]]
        t_b = TOKENS[tokens[1]]
        uni_rates = scan_pair(t_a, t_b, BASE_AMOUNT if tokens[0] != "USDC" else BASE_AMOUNT_6)
        for r in uni_rates:
            deviation = abs(1 - r.rate) * 100
            direction = "ABOVE peg" if r.rate > 1 else "BELOW peg"
            print(f"     [{r.source:20s}]: 1 {tokens[0]} = {r.rate:.8f} {tokens[1]}  ({deviation:.4f}% {direction})")

    print("\n" + "=" * 80)
    print("Scan complete. Rates will change block-to-block.")


if __name__ == "__main__":
    main()
