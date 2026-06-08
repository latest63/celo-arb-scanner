#!/usr/bin/env python3
"""
Celo Cross-Stable Triangular Arbitrage Scanner v2
Fixed decimal handling + direct Mento pool reads
"""

import json
import time
import requests
from web3 import Web3
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
from datetime import datetime

# ── RPC ──
CELO_RPC = "https://forno.celo.org"
w3 = Web3(Web3.HTTPProvider(CELO_RPC))

# ── Contracts (Mainnet) ──
MENTO_ROUTER = Web3.to_checksum_address("0x4861840C2EfB2b98312B0aE34d86fD73E8f9B6f6")
UNI_QUOTER = Web3.to_checksum_address("0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8")
WCELO = Web3.to_checksum_address("0x471EcE3750Da237f93B8E339c536989b8978a438")

# Tokens with their decimals
TOKENS = {
    "USDm":  {"addr": "0x765DE816845861e75A25fCA122bb6898B8B1282a", "dec": 18},
    "EURm":  {"addr": "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73", "dec": 18},
    "BRLm":  {"addr": "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787", "dec": 18},
    "KESm":  {"addr": "0x456a3D042C0DbD3db53D5489e98dFb038553B0d0", "dec": 18},
    "NGNm":  {"addr": "0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71", "dec": 18},
    "GHSm":  {"addr": "0xfAeA5F3404bbA20D3cc2f8C4B0A888F55a3c7313", "dec": 18},
    "XOFm":  {"addr": "0x73F93dcc49cB8A239e2032663e9475dd5ef29A08", "dec": 18},
    "ZARm":  {"addr": "0x4c35853A3B4e647fD266f4de678dCc8fEC410BF6", "dec": 18},
    "PHPm":  {"addr": "0x105d4A9306D2E55a71d2Eb95B81553AE1dC20d7B", "dec": 18},
    "GBPm":  {"addr": "0xCCF663b1fF11028f0b19058d0f7B674004a40746", "dec": 18},
    "COPm":  {"addr": "0x8A567e2aE79CA692Bd748aB832081C45de4041eA", "dec": 18},
    "JPYm":  {"addr": "0xc45eCF20f3CD864B32D9794d6f76814aE8892e20", "dec": 18},
    "USDC":  {"addr": "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", "dec": 6},
    "USDT":  {"addr": "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", "dec": 6},
}

# Mento FPMM Pool Addresses
MENTO_FPMM_POOLS = {
    "USDC/USDm": Web3.to_checksum_address("0x462fe04b4FD719Cbd04C0310365D421D02AaA19E"),
    "USDT/USDm": Web3.to_checksum_address("0x0FEBa760d93423D127DE1B6ABECdB60E5253228D"),
    "GBPm/USDm": Web3.to_checksum_address("0x8C0014afe032E4574481D8934504100bF23fCB56"),
    "NGNm/USDm": Web3.to_checksum_address("0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71"),
    "KESm/USDm": Web3.to_checksum_address("0x456a3D042C0DbD3db53D5489e98dFb038553B0d0"),
}

# ── Minimal ABIs ──

# Uniswap V3 QuoterV2
QUOTER_ABI = [
    {"inputs":[{"components":[{"name":"tokenIn","type":"address"},{"name":"tokenOut","type":"address"},{"name":"amountIn","type":"uint256"},{"name":"fee","type":"uint24"},{"name":"sqrtPriceLimitX96","type":"uint160"}],"name":"params","type":"tuple"}],"name":"quoteExactInputSingle","outputs":[{"name":"amountOut","type":"uint256"},{"name":"sqrtPriceX96After","type":"uint160"},{"name":"initializedTicksCrossed","type":"uint32"},{"name":"gasEstimate","type":"uint256"}],"stateMutability":"view","type":"function"}
]

# Mento V3 FPMM Pool ABI — used to read reserves
FPMM_POOL_ABI = [
    {"inputs":[],"name":"asset","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"share","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"oracle","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    # getAmountOut based on FPMM spec
    {"inputs":[{"name":"amountIn","type":"uint256"},{"name":"tokenIn","type":"address"}],"name":"getAmountOut","outputs":[{"name":"amountOut","type":"uint256"}],"stateMutability":"view","type":"function"},
]

# ERC20 minimal
ERC20_ABI = [
    {"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"type":"function"},
    {"constant":True,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"type":"function"},
]

# Uniswap V3 Factory — to find pool addresses
UNI_FACTORY_ABI = [
    {"inputs":[{"name":"token0","type":"address"},{"name":"token1","type":"address"},{"name":"fee","type":"uint24"}],"name":"getPool","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"}
]
UNI_V3_FACTORY = Web3.to_checksum_address("0xAfE208a311B21f13EF87E33A90049fC17A7acDEc")

# Uniswap V3 Pool ABI (just slot0 for sqrtPrice)
POOL_ABI = [
    {"inputs":[],"name":"slot0","outputs":[{"name":"sqrtPriceX96","type":"uint160"},{"name":"tick","type":"int24"},{"name":"observationIndex","type":"uint16"},{"name":"observationCardinality","type":"uint16"},{"name":"observationCardinalityNext","type":"uint16"},{"name":"feeProtocol","type":"uint8"},{"name":"unlocked","type":"bool"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"liquidity","outputs":[{"name":"","type":"uint128"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"token0","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"token1","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
]


@dataclass
class RateSnapshot:
    timestamp: float
    source: str
    pair: str
    rate: float
    liquidity_usd: float = 0.0


def get_token_info(addr: str) -> Tuple[str, int]:
    """Get symbol and decimals."""
    c = w3.eth.contract(address=Web3.to_checksum_address(addr), abi=ERC20_ABI)
    try:
        return c.functions.symbol().call(), c.functions.decimals().call()
    except:
        return addr[:10], 18


def sqrt_price_to_rate(sqrtPriceX96: int, t0: str, t1: str, d0: int, d1: int) -> float:
    """Convert Uniswap sqrtPriceX96 to human-readable rate (token1 per token0)."""
    price = (sqrtPriceX96 / 2**96) ** 2
    # Adjust for decimal difference
    return price * (10**d0) / (10**d1)


def query_uniswap_pool_direct(token_a: str, token_b: str, d_a: int, d_b: int,
                                fee: int = 3000) -> Optional[RateSnapshot]:
    """Read Uniswap V3 pool price directly from slot0."""
    try:
        factory = w3.eth.contract(address=UNI_V3_FACTORY, abi=UNI_FACTORY_ABI)
        pool_addr = factory.functions.getPool(
            Web3.to_checksum_address(token_a),
            Web3.to_checksum_address(token_b),
            fee
        ).call()
        if pool_addr == "0x0000000000000000000000000000000000000000":
            return None

        pool = w3.eth.contract(address=pool_addr, abi=POOL_ABI)
        slot0 = pool.functions.slot0().call()
        t0 = pool.functions.token0().call()
        t1 = pool.functions.token1().call()
        liq = pool.functions.liquidity().call()

        sqrtPriceX96 = slot0[0]
        # Always return rate as token1 per token0
        rate = sqrt_price_to_rate(sqrtPriceX96, t0, t1, d_a, d_b) if t0.lower() == token_a.lower() else \
               1.0 / sqrt_price_to_rate(sqrtPriceX96, t1, t0, d_b, d_a)

        sym_a, _ = get_token_info(token_a)
        sym_b, _ = get_token_info(token_b)

        # Rough liquidity estimate (USD value of liquidity * sqrt(price))
        tvl_est = liq * (sqrtPriceX96 / 2**96) / 1e18 * 2 if liq > 0 else 0

        return RateSnapshot(
            timestamp=time.time(),
            source=f"UniV3-{fee}bps",
            pair=f"{sym_a}/{sym_b}",
            rate=rate,
            liquidity_usd=float(tvl_est),
        )
    except Exception as e:
        return None


def query_uniswap_quoter(token_a: str, token_b: str, amount_in: int) -> Optional[float]:
    """Get swap rate via Uniswap V3 QuoterV2."""
    try:
        quoter = w3.eth.contract(address=UNI_QUOTER, abi=QUOTER_ABI)
        result = quoter.functions.quoteExactInputSingle({
            "tokenIn": Web3.to_checksum_address(token_a),
            "tokenOut": Web3.to_checksum_address(token_b),
            "amountIn": amount_in,
            "fee": 3000,
            "sqrtPriceLimitX96": 0,
        }).call()
        return result[0] / amount_in
    except:
        return None


def query_mento_fpmm_pool(pool_addr: str, token_in: str, amount_in: int) -> Optional[float]:
    """Read rate from a Mento V3 FPMM pool directly."""
    try:
        pool = w3.eth.contract(address=pool_addr, abi=FPMM_POOL_ABI)
        asset = pool.functions.asset().call()
        share = pool.functions.share().call()

        amount_out = pool.functions.getAmountOut(
            amount_in,
            Web3.to_checksum_address(token_in)
        ).call()
        return amount_out / amount_in
    except Exception as e:
        return None


def get_mento_pool_metadata(pool_addr: str) -> Tuple[str, str, int, int]:
    """Get asset/share tokens and their decimals from a Mento FPMM pool."""
    pool = w3.eth.contract(address=pool_addr, abi=FPMM_POOL_ABI)
    asset = pool.functions.asset().call()
    share = pool.functions.share().call()
    _, d_a = get_token_info(asset)
    _, d_s = get_token_info(share)
    s_a, _ = get_token_info(asset)
    s_s, _ = get_token_info(share)
    return s_a, s_s, d_a, d_s


def scan_pair_direct(token_a: str, token_b: str) -> List[RateSnapshot]:
    """Scan a pair across all sources using direct pool reads."""
    rates = []
    sym_a, dec_a = get_token_info(token_a)
    sym_b, dec_b = get_token_info(token_b)
    base_amt = 10 ** min(dec_a, dec_b)  # 1 unit in smallest decimal

    # Uniswap V3 — direct pool reads for multiple fee tiers
    for fee in [100, 500, 3000]:
        r = query_uniswap_pool_direct(token_a, token_b, dec_a, dec_b, fee)
        if r:
            rates.append(r)

    # Also try the quoter
    q = query_uniswap_quoter(token_a, token_b, base_amt)
    if q and q > 0:
        rates.append(RateSnapshot(time.time(), f"UniV3-Quoter", f"{sym_a}/{sym_b}", q))

    # Mento FPMM pools — look up by known pair name
    pair_name = f"{sym_a}/{sym_b}"
    rev_pair = f"{sym_b}/{sym_a}"
    pool_addr = None
    for name, addr in MENTO_FPMM_POOLS.items():
        if name == pair_name:
            pool_addr = addr
            break
        if name == rev_pair:
            pool_addr = addr
            token_in = token_b
            break

    if pool_addr:
        amt = 10 ** dec_a
        r = query_mento_fpmm_pool(pool_addr, token_a, amt)
        if r and r > 0:
            rates.append(RateSnapshot(time.time(), "MentoV3-FPMM", pair_name, r))

    return rates


def main():
    print("=" * 85)
    print(f"CELO CROSS-STABLE ARBITRAGE SCANNER v2")
    print(f"Block: {w3.eth.block_number}  |  {datetime.now().isoformat()}")
    print("=" * 85)

    local_stables = ["KESm", "NGNm", "GHSm", "ZARm", "PHPm", "XOFm", "BRLm", "COPm"]
    usdm_addr = TOKENS["USDm"]["addr"]
    usdc_addr = TOKENS["USDC"]["addr"]

    # ── 1. Local stable rates vs USDm ──
    print("\n📍 LOCAL-CURRENCY STABLE vs USDm")
    print("-" * 70)

    for sym in local_stables:
        addr = TOKENS[sym]["addr"]
        rates = scan_pair_direct(addr, usdm_addr)
        for r in rates:
            inv = 1 / r.rate if r.rate > 0 else 0
            liq_str = f"  TVL:~${r.liquidity_usd:,.0f}" if r.liquidity_usd > 0 else ""
            print(f"  {sym}→USDm [{r.source:20s}]: 1 {sym} = {r.rate:.8f} USDm  (1 USDm = {inv:.2f} {sym}){liq_str}")

    # ── 2. Direct cross-stable pairs ──
    print("\n📍 DIRECT CROSS-STABLE PAIRS")
    print("-" * 70)

    cross_pairs = [
        (TOKENS["EURm"]["addr"], usdm_addr, "EURm/USDm"),
        (TOKENS["GBPm"]["addr"], usdm_addr, "GBPm/USDm"),
        (TOKENS["KESm"]["addr"], TOKENS["NGNm"]["addr"], "KESm/NGNm"),
        (TOKENS["NGNm"]["addr"], TOKENS["GHSm"]["addr"], "NGNm/GHSm"),
        (TOKENS["KESm"]["addr"], TOKENS["GHSm"]["addr"], "KESm/GHSm"),
    ]

    for t_a, t_b, name in cross_pairs:
        rates = scan_pair_direct(t_a, t_b)
        for r in rates:
            print(f"  {name:<12s} [{r.source:20s}]: {r.rate:.8f}")

    # ── 3. Triangular arb ──
    print("\n🔺 TRIANGULAR ARB SCAN")
    print("-" * 70)

    triangles = [
        ("EURm → USDm → USDC → EURm",
         [TOKENS["EURm"]["addr"], usdm_addr, usdc_addr, TOKENS["EURm"]["addr"]]),
        ("NGNm → USDm → KESm → NGNm",
         [TOKENS["NGNm"]["addr"], usdm_addr, TOKENS["KESm"]["addr"], TOKENS["NGNm"]["addr"]]),
        ("KESm → USDm → GHSm → KESm",
         [TOKENS["KESm"]["addr"], usdm_addr, TOKENS["GHSm"]["addr"], TOKENS["KESm"]["addr"]]),
        ("KESm → USDm → NGNm → KESm",
         [TOKENS["KESm"]["addr"], usdm_addr, TOKENS["NGNm"]["addr"], TOKENS["KESm"]["addr"]]),
        ("BRLm → USDm → EURm → BRLm",
         [TOKENS["BRLm"]["addr"], usdm_addr, TOKENS["EURm"]["addr"], TOKENS["BRLm"]["addr"]]),
    ]

    for name, path in triangles:
        print(f"\n  ▸ {name}")
        # Get rates for each leg
        leg_rates = []
        for i in range(len(path) - 1):
            t_a, t_b = path[i], path[i + 1]
            rates = scan_pair_direct(t_a, t_b)
            best = max(rates, key=lambda r: r.rate) if rates else None
            if best:
                leg_rates.append(best)
                print(f"    {best.source:20s}: {best.rate:.8f}  ({best.pair})")

        if len(leg_rates) == 3:
            product = leg_rates[0].rate * leg_rates[1].rate * leg_rates[2].rate
            spread = (product - 1.0) * 100
            if spread > 0:
                print(f"    ✅ PROFITABLE: {spread:.6f}% spread")
            else:
                print(f"    ❌ No arb: {spread:.6f}% (need > 0%)")

    # ── 4. Mento oracle peg vs DEX comparison ──
    print("\n📊 ORACLE vs DEX PRICE COMPARISON")
    print("-" * 70)
    print("  Stablecoins should trade near 1:1 with each other on Mento (oracle peg)")
    print("  Deviation from 1 = arb opportunity\n")

    for pair_name, pool_addr in MENTO_FPMM_POOLS.items():
        tokens = pair_name.split("/")
        if tokens[0] in TOKENS and tokens[1] in TOKENS:
            t_a = TOKENS[tokens[0]]["addr"]
            t_b = TOKENS[tokens[1]]["addr"]

            # Mento rate
            amt = 10 ** TOKENS[tokens[0]]["dec"]
            mento_rate = query_mento_fpmm_pool(pool_addr, t_a, amt)

            print(f"  {pair_name}:")
            if mento_rate:
                deviation = abs(1 - mento_rate) * 100
                dir_mark = "🔴 ABOVE peg" if mento_rate > 1 else "🔵 BELOW peg" if mento_rate < 1 else "✅ AT peg"
                print(f"    MentoV3-FPMM : {mento_rate:.8f}  ({deviation:.4f}% {dir_mark})")

            # DEX comparison
            dex_rates = scan_pair_direct(t_a, t_b)
            for dr in dex_rates:
                deviation = abs(1 - dr.rate) * 100
                dir_mark = "🔴 ABOVE peg" if dr.rate > 1 else "🔵 BELOW peg" if dr.rate < 1 else "✅ AT peg"
                arb_versus_mento = ""
                if mento_rate and mento_rate > 0:
                    diff_vs_mento = (dr.rate / mento_rate - 1) * 100
                    arb_versus_mento = f"  (vs Mento: {diff_vs_mento:+.4f}%)"
                print(f"    {dr.source:20s}: {dr.rate:.8f}  ({deviation:.4f}% {dir_mark}){arb_versus_mento}")

    print("\n" + "=" * 85)
    print("Done. Refresh with each new block (~1s).")


if __name__ == "__main__":
    main()
