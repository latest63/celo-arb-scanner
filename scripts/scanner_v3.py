#!/usr/bin/env python3
"""
Celo Cross-Stable Arbitrage Scanner v3 — Clean & production-ready
Focus: cross-stable triangles + local-currency FX arb on Celo
"""

import time, sys
from web3 import Web3
from typing import List, Tuple, Optional
from dataclasses import dataclass
from datetime import datetime

CELO_RPC = "https://forno.celo.org"
w3 = Web3(Web3.HTTPProvider(CELO_RPC))

# ── Tokens ──
TOKENS = {
    "USDm":  ("0x765DE816845861e75A25fCA122bb6898B8B1282a", 18),
    "EURm":  ("0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73", 18),
    "BRLm":  ("0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787", 18),
    "KESm":  ("0x456a3D042C0DbD3db53D5489e98dFb038553B0d0", 18),
    "NGNm":  ("0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71", 18),
    "GHSm":  ("0xfAeA5F3404bbA20D3cc2f8C4B0A888F55a3c7313", 18),
    "XOFm":  ("0x73F93dcc49cB8A239e2032663e9475dd5ef29A08", 18),
    "ZARm":  ("0x4c35853A3B4e647fD266f4de678dCc8fEC410BF6", 18),
    "PHPm":  ("0x105d4A9306D2E55a71d2Eb95B81553AE1dC20d7B", 18),
    "GBPm":  ("0xCCF663b1fF11028f0b19058d0f7B674004a40746", 18),
    "COPm":  ("0x8A567e2aE79CA692Bd748aB832081C45de4041eA", 18),
    "USDC":  ("0xcebA9300f2b948710d2653dD7B07f33A8B32118C", 6),
    "USDT":  ("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", 6),
}

# Main USDC/USDm FPMM pool = Mento's primary stable-swap pool
MENTO_FPMM_POOL = Web3.to_checksum_address("0x462fe04b4FD719Cbd04C0310365D421D02AaA19E")
MENTO_ROUTER = Web3.to_checksum_address("0x4861840C2EfB2b98312B0aE34d86fD73E8f9B6f6")
UNI_V3_FACTORY = Web3.to_checksum_address("0xAfE208a311B21f13EF87E33A90049fC17A7acDEc")

# ── ABIs ──
ERC20_ABI = [{"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"type":"function"}]

FACTORY_ABI = [{"inputs":[{"name":"token0","type":"address"},{"name":"token1","type":"address"},{"name":"fee","type":"uint24"}],"name":"getPool","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"}]

POOL_ABI = [
    {"inputs":[],"name":"slot0","outputs":[{"name":"sqrtPriceX96","type":"uint160"},{"name":"tick","type":"int24"},{"name":"observationIndex","type":"uint16"},{"name":"observationCardinality","type":"uint16"},{"name":"observationCardinalityNext","type":"uint16"},{"name":"feeProtocol","type":"uint8"},{"name":"unlocked","type":"bool"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"token0","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"token1","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"liquidity","outputs":[{"name":"","type":"uint128"}],"stateMutability":"view","type":"function"},
]

FPMM_ABI = [
    {"inputs":[],"name":"asset","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"share","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"amountIn","type":"uint256"},{"name":"tokenIn","type":"address"}],"name":"getAmountOut","outputs":[{"name":"amountOut","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"oracleAdapter","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
]


@dataclass
class Quote:
    source: str
    rate: float  # out per in
    pair: str

    def __repr__(self):
        return f"[{self.source:18s}] {self.pair}: {self.rate:.8f}"


def sqrt_to_rate(sqrtX96: int, t0: str, t1: str, d0: int, d1: int) -> float:
    """sqrtPriceX96 → token1/token0 rate with decimal adjustment."""
    p = (sqrtX96 / 2**96) ** 2
    return p * (10**d0) / (10**d1)


def find_uni_pool(t0: str, t1: str, fee: int) -> Optional[Tuple[float, float]]:
    """Find Uniswap V3 pool and return (rate, liquidity)."""
    try:
        f = w3.eth.contract(address=UNI_V3_FACTORY, abi=FACTORY_ABI)
        addr = f.functions.getPool(
            Web3.to_checksum_address(t0),
            Web3.to_checksum_address(t1),
            fee
        ).call()
        if addr == "0x0000000000000000000000000000000000000000":
            return None
        pool = w3.eth.contract(address=addr, abi=POOL_ABI)
        s0 = pool.functions.slot0().call()
        liq = pool.functions.liquidity().call()
        p0 = pool.functions.token0().call()
        p1 = pool.functions.token1().call()

        # Determine decimals
        d = lambda a: next(v[1] for k, v in TOKENS.items() if v[0].lower() == a.lower())
        try:
            d0, d1 = d(p0), d(p1)
        except StopIteration:
            # Unknown token, try on-chain
            c = w3.eth.contract(address=Web3.to_checksum_address(p0), abi=ERC20_ABI)
            d0 = c.functions.decimals().call()
            c = w3.eth.contract(address=Web3.to_checksum_address(p1), abi=ERC20_ABI)
            d1 = c.functions.decimals().call()

        rate = sqrt_to_rate(s0[0], p0, p1, d0, d1)

        # Normalize to quote/token direction: we return rate as token1(t1) per token0(t0)
        if p0.lower() == Web3.to_checksum_address(t0).lower():
            return rate, float(liq)
        else:
            return 1.0 / rate, float(liq)
    except Exception as e:
        return None


def get_mento_fpmm_rate(pool_addr: str, t_in: str, t_out: str) -> Optional[float]:
    """Get rate through Mento FPMM pool."""
    try:
        pool = w3.eth.contract(address=pool_addr, abi=FPMM_ABI)
        asset = pool.functions.asset().call()
        share = pool.functions.share().call()

        # Determine which token is asset vs share
        if asset.lower() == Web3.to_checksum_address(t_in).lower():
            decimals = next(v[1] for k, v in TOKENS.items() if v[0].lower() == t_in.lower())
            amt = 10 ** decimals
            out = pool.functions.getAmountOut(amt, t_in).call()
            if out == 0:
                return None
            return out / amt
        elif share.lower() == Web3.to_checksum_address(t_in).lower():
            decimals = next(v[1] for k, v in TOKENS.items() if v[0].lower() == t_in.lower())
            amt = 10 ** decimals
            out = pool.functions.getAmountOut(amt, t_in).call()
            if out == 0:
                return None
            return out / amt
        return None
    except:
        return None


def scan(pair_name: str, t0: str, t1: str) -> List[Quote]:
    """Scan a pair across all sources. Returns list of Quotes (best first)."""
    quotes = []

    # Uniswap V3 — 3 fee tiers
    for fee in [100, 500, 3000]:
        r = find_uni_pool(t0, t1, fee)
        if r and r[0] > 0 and r[0] < 1e6:  # sanity filter
            quotes.append(Quote(f"UniV3-{fee}bps", r[0], pair_name))

    # Mento FPMM (for USDC/USDm, USDT/USDm, GBPm/USDm primarily)
    if pair_name in ["USDC/USDm", "USDT/USDm", "GBPm/USDm"]:
        r = get_mento_fpmm_rate(MENTO_FPMM_POOL, t0, t1)
        if r and 0 < r < 1e6:
            quotes.append(Quote("MentoFPMM", r, pair_name))

    return sorted(quotes, key=lambda q: q.rate)


def expected_fx_rate(sym: str) -> float:
    """Return the expected USD exchange rate for a local stable."""
    rates = {
        "KESm": 0.00768,  # 130 KES/USD
        "NGNm": 0.00065,  # 1540 NGN/USD
        "GHSm": 0.0685,   # 14.6 GHS/USD
        "ZARm": 0.0535,   # 18.7 ZAR/USD
        "PHPm": 0.0173,   # 57.8 PHP/USD
        "XOFm": 0.00168,  # 595 XOF/USD (pegged to EUR)
        "BRLm": 0.194,    # 5.15 BRL/USD
        "COPm": 0.00024,  # 4167 COP/USD
        "EURm": 1.15,     # 1.15 EUR/USD
        "GBPm": 1.35,     # 1.35 GBP/USD
    }
    return rates.get(sym, 1.0)


def main():
    print(f"\n{'='*90}")
    print(f"  CELO CROSS-STABLE ARBITRAGE SCANNER v3")
    print(f"  Block #{w3.eth.block_number}  |  {datetime.now().isoformat()}")
    print(f"{'='*90}\n")

    usdm = TOKENS["USDm"][0]
    usdc = TOKENS["USDC"][0]

    # ── 1. Local stables vs USDm (with FX deviation) ──
    print("📊 LOCAL STABLE vs USDm — FX Deviation Scan")
    print(f"  {'Pair':<10s} {'Source':<20s} {'Rate':>14s} {'Expected':>10s} {'Dev%':>8s} {'Liq Est':>10s}")
    print(f"  {'-'*10} {'-'*20} {'-'*14} {'-'*10} {'-'*8} {'-'*10}")

    for sym in ["KESm", "NGNm", "GHSm", "ZARm", "PHPm", "XOFm", "BRLm", "COPm", "EURm", "GBPm"]:
        addr = TOKENS[sym][0]
        qs = scan(f"{sym}/USDm", addr, usdm)
        expected = expected_fx_rate(sym)
        for q in qs:
            dev = (q.rate / expected - 1) * 100
            print(f"  {q.pair:<10s} {q.source:<20s} {q.rate:>14.8f} {expected:>10.6f} {dev:>+7.4f}%")

    # ── 2. Cross-stable direct pairs ──
    print(f"\n📊 DIRECT CROSS-STABLE PAIRS")
    print(f"  {'Pair':<14s} {'Source':<20s} {'Rate':>14s}")
    print(f"  {'-'*14} {'-'*20} {'-'*14}")

    pairs = [
        ("EURm/USDm", TOKENS["EURm"][0], usdm),
        ("GBPm/USDm", TOKENS["GBPm"][0], usdm),
        ("USDC/USDm", usdc, usdm),
        ("USDT/USDm", TOKENS["USDT"][0], usdm),
        ("EURm/USDC", TOKENS["EURm"][0], usdc),
        ("BRLm/EURm", TOKENS["BRLm"][0], TOKENS["EURm"][0]),
    ]
    for name, t0, t1 in pairs:
        qs = scan(name, t0, t1)
        for q in qs:
            print(f"  {q.pair:<14s} {q.source:<20s} {q.rate:>14.8f}")

    # ── 3. Triangular Arb Scan ──
    print(f"\n🔺 TRIANGULAR ARBITRAGE SCAN")
    print(f"  {'Triangle':<40s} {'Leg1':>12s} {'Leg2':>12s} {'Leg3':>12s} {'Product':>12s} {'Spread':>10s}")
    print(f"  {'-'*40} {'-'*12} {'-'*12} {'-'*12} {'-'*12} {'-'*10}")

    triangles = [
        ("EURm→USDm→USDC→EURm", TOKENS["EURm"][0], usdm, usdc, TOKENS["EURm"][0]),
        ("BRLm→USDm→EURm→BRLm", TOKENS["BRLm"][0], usdm, TOKENS["EURm"][0], TOKENS["BRLm"][0]),
        ("KESm→USDm→EURm→KESm", TOKENS["KESm"][0], usdm, TOKENS["EURm"][0], TOKENS["KESm"][0]),
        ("NGNm→USDm→KESm→NGNm", TOKENS["NGNm"][0], usdm, TOKENS["KESm"][0], TOKENS["NGNm"][0]),
        ("USDC→USDm→EURm→USDC", usdc, usdm, TOKENS["EURm"][0], usdc),
    ]

    for name, a, b, c, d in triangles:
        leg1 = scan(f"{name.split('→')[0]}/{name.split('→')[1]}", a, b)
        leg2 = scan(f"{name.split('→')[1]}/{name.split('→')[2]}", b, c)
        leg3 = scan(f"{name.split('→')[2]}/{name.split('→')[3]}", c, d)

        # Take best rate for each leg
        r1 = max([q.rate for q in leg1]) if leg1 else 0
        r2 = max([q.rate for q in leg2]) if leg2 else 0
        r3 = max([q.rate for q in leg3]) if leg3 else 0

        if r1 > 0 and r2 > 0 and r3 > 0:
            product = r1 * r2 * r3
            spread = (product - 1) * 100
            flag = "✅" if spread > 0.01 else ("⚠️" if spread > 0 else "❌")
            print(f"  {flag} {name:<38s} {r1:>12.6f} {r2:>12.6f} {r3:>12.6f} {product:>12.8f} {spread:>+9.6f}%")
        else:
            missing = []
            if not leg1: missing.append("leg1")
            if not leg2: missing.append("leg2")
            if not leg3: missing.append("leg3")
            print(f"  ⚠️  {name:<38s} (missing: {', '.join(missing)})")

    # ── 4. Mento FPMM vs DEX arb (same pair, different venues) ──
    print(f"\n📊 VENUE ARBITRAGE (same pair, different DEX)")
    print(f"  {'Pair':<14s} {'Venues':>30s} {'Spread':>10s}")
    print(f"  {'-'*14} {'-'*30} {'-'*10}")

    arb_pairs = [
        ("USDC/USDm", usdc, usdm),
        ("USDT/USDm", TOKENS["USDT"][0], usdm),
        ("EURm/USDm", TOKENS["EURm"][0], usdm),
    ]
    for name, t0, t1 in arb_pairs:
        qs = scan(name, t0, t1)
        if len(qs) >= 2:
            best = max(qs, key=lambda q: q.rate)
            worst = min(qs, key=lambda q: q.rate)
            spread = (best.rate / worst.rate - 1) * 100
            print(f"  {name:<14s} {worst.source:<15s} vs {best.source:<15s} {spread:>+9.6f}%")
        elif qs:
            print(f"  {name:<14s} {'Only 1 venue found':>30s}")
        else:
            print(f"  {name:<14s} {'No liquidity':>30s}")

    print(f"\n{'='*90}")
    print(f"  Scan complete — rates change every block (~1s)")
    print(f"{'='*90}")


if __name__ == "__main__":
    main()
