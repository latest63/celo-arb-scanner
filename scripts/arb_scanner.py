#!/usr/bin/env python3
"""
Celo Cross-Stable Arbitrage Scanner
Monitors real-time cross-stable & triangular arb opportunities across Mento & Celo DEXs
"""
import time, json, os, sys
from web3 import Web3
from typing import List, Tuple, Optional
from dataclasses import dataclass, asdict
from datetime import datetime

# ── Config ──
CELO_RPC = os.getenv("CELO_RPC", "https://forno.celo.org")
MIN_SPREAD_PCT = float(os.getenv("MIN_SPREAD", "0.01"))  # alert threshold
OUTPUT_FILE = os.getenv("OUTPUT_FILE", "")

w3 = Web3(Web3.HTTPProvider(CELO_RPC))

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
    "USDC":  ("0xcebA9300f2b948710d2653dD7B07f33A8B32118C", 6),
    "USDT":  ("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", 6),
}

UNI_V3_FACTORY = Web3.to_checksum_address("0xAfE208a311B21f13EF87E33A90049fC17A7acDEc")

FACTORY_ABI = [{"inputs":[{"name":"token0","type":"address"},{"name":"token1","type":"address"},{"name":"fee","type":"uint24"}],"name":"getPool","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"}]
POOL_ABI = [
    {"inputs":[],"name":"slot0","outputs":[{"name":"sqrtPriceX96","type":"uint160"},{"name":"tick","type":"int24"},{"name":"observationIndex","type":"uint16"},{"name":"observationCardinality","type":"uint16"},{"name":"observationCardinalityNext","type":"uint16"},{"name":"feeProtocol","type":"uint8"},{"name":"unlocked","type":"bool"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"token0","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"token1","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"liquidity","outputs":[{"name":"","type":"uint128"}],"stateMutability":"view","type":"function"},
]
ERC20_ABI = [{"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"type":"function"}]


@dataclass
class Quote:
    source: str
    rate: float
    pair: str
    liquidity: float = 0.0


def sqrt_to_rate(sqrtX96, t0, t1, d0, d1):
    p = (sqrtX96 / 2**96) ** 2
    return p * (10**d0) / (10**d1)


def find_uni_pool(t0, t1, fee):
    try:
        f = w3.eth.contract(address=UNI_V3_FACTORY, abi=FACTORY_ABI)
        addr = f.functions.getPool(Web3.to_checksum_address(t0), Web3.to_checksum_address(t1), fee).call()
        if addr == "0x0000000000000000000000000000000000000000": return None
        pool = w3.eth.contract(address=addr, abi=POOL_ABI)
        s0 = pool.functions.slot0().call()
        liq = pool.functions.liquidity().call()
        p0, p1 = pool.functions.token0().call(), pool.functions.token1().call()
        d = lambda a: next(v[1] for k, v in TOKENS.items() if v[0].lower() == a.lower())
        try: d0, d1 = d(p0), d(p1)
        except: return None
        rate = sqrt_to_rate(s0[0], p0, p1, d0, d1)
        chain_t0 = Web3.to_checksum_address(t0).lower()
        return (rate, float(liq)) if p0.lower() == chain_t0 else (1.0/rate, float(liq))
    except: return None


def scan(pair_name, t0, t1):
    quotes = []
    for fee in [100, 500, 3000]:
        r = find_uni_pool(t0, t1, fee)
        if r and 0 < r[0] < 1e6:
            quotes.append(Quote(f"UniV3-{fee}bps", r[0], pair_name, r[1]))
    return sorted(quotes, key=lambda q: q.rate)


def scan_all():
    """Full scan returning structured data."""
    usdm, usdc = TOKENS["USDm"][0], TOKENS["USDC"][0]
    results = {"block": w3.eth.block_number, "timestamp": datetime.now().isoformat(), "opportunities": [], "pairs": {}}

    # Local stables vs USDm
    for sym in ["KESm", "NGNm", "GHSm", "ZARm", "PHPm", "XOFm", "BRLm", "EURm", "GBPm"]:
        addr = TOKENS[sym][0]
        qs = scan(f"{sym}/USDm", addr, usdm)
        if qs:
            results["pairs"][f"{sym}/USDm"] = [{"source": q.source, "rate": round(q.rate, 8), "liquidity": q.liquidity} for q in qs]

    # Major pairs
    for name, t0, t1 in [
        ("EURm/USDm", TOKENS["EURm"][0], usdm),
        ("GBPm/USDm", TOKENS["GBPm"][0], usdm),
        ("USDC/USDm", usdc, usdm),
        ("USDT/USDm", TOKENS["USDT"][0], usdm),
        ("EURm/USDC", TOKENS["EURm"][0], usdc),
    ]:
        qs = scan(name, t0, t1)
        if qs:
            results["pairs"][name] = [{"source": q.source, "rate": round(q.rate, 8)} for q in qs]

    # Triangles
    triangles = [
        ("KESm->USDm->EURm->KESm", TOKENS["KESm"][0], usdm, TOKENS["EURm"][0], TOKENS["KESm"][0]),
        ("USDC->USDm->EURm->USDC", usdc, usdm, TOKENS["EURm"][0], usdc),
        ("BRLm->USDm->EURm->BRLm", TOKENS["BRLm"][0], usdm, TOKENS["EURm"][0], TOKENS["BRLm"][0]),
        ("NGNm->USDm->KESm->NGNm", TOKENS["NGNm"][0], usdm, TOKENS["KESm"][0], TOKENS["NGNm"][0]),
    ]
    for name, a, b, c, d_ in triangles:
        parts = name.split("->")
        l1 = scan(f"{parts[0]}/{parts[1]}", a, b)
        l2 = scan(f"{parts[1]}/{parts[2]}", b, c)
        l3 = scan(f"{parts[2]}/{parts[3]}", c, d_)
        r1 = max([q.rate for q in l1]) if l1 else 0
        r2 = max([q.rate for q in l2]) if l2 else 0
        r3 = max([q.rate for q in l3]) if l3 else 0
        if r1 > 0 and r2 > 0 and r3 > 0:
            product = r1 * r2 * r3
            spread = (product - 1) * 100
            results["opportunities"].append({
                "type": "triangular",
                "name": name,
                "legs": [round(r1,8), round(r2,8), round(r3,8)],
                "product": round(product, 8),
                "spread_pct": round(spread, 6),
                "profitable": spread > 0,
            })

    # Venue arb
    for name, t0, t1 in [("USDC/USDm", usdc, usdm), ("USDT/USDm", TOKENS["USDT"][0], usdm), ("EURm/USDm", TOKENS["EURm"][0], usdm)]:
        qs = scan(name, t0, t1)
        if len(qs) >= 2:
            best, worst = max(qs, key=lambda q: q.rate), min(qs, key=lambda q: q.rate)
            spread = (best.rate / worst.rate - 1) * 100
            results["opportunities"].append({
                "type": "venue_arb",
                "pair": name,
                "best": {"source": best.source, "rate": round(best.rate, 8)},
                "worst": {"source": worst.source, "rate": round(worst.rate, 8)},
                "spread_pct": round(spread, 6),
                "profitable": spread > 0,
            })

    results["alerts"] = [o for o in results["opportunities"] if o.get("spread_pct", 0) >= MIN_SPREAD_PCT]
    return results


def format_for_terminal(data):
    """Format for terminal display."""
    lines = []
    lines.append("=" * 75)
    lines.append(f"CELO ARB SCANNER  |  Block #{data['block']}  |  {data['timestamp']}")
    lines.append("=" * 75)

    if data["alerts"]:
        lines.append("\n  🚨 ALERTS (spread >= threshold)")
        for a in data["alerts"]:
            flag = "🔴" if a["spread_pct"] > 0.1 else "🟡"
            if a["type"] == "triangular":
                lines.append(f"  {flag}  {a['name']}:  {a['spread_pct']:+.4f}%")
            else:
                lines.append(f"  {flag}  {a['pair']} venue arb:  {a['spread_pct']:+.4f}%")
        lines.append("")

    # Key rates
    for pair_name in ["KESm/USDm", "XOFm/USDm", "BRLm/USDm", "EURm/USDm", "USDC/USDm", "USDT/USDm"]:
        if pair_name in data["pairs"]:
            rates = [f"{q['source']}={q['rate']:.6f}" for q in data["pairs"][pair_name]]
            lines.append(f"  {pair_name:<14s}  {'  |  '.join(rates)}")

    if data["opportunities"]:
        lines.append("")
        for o in data["opportunities"]:
            if o["type"] == "triangular":
                lines.append(f"  △  {o['name']:<32s}  {o['spread_pct']:+.6f}%")
            else:
                lines.append(f"  ○  {o['pair']:<14s} venue arb  {o['spread_pct']:+.6f}%")

    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    data = scan_all()
    text = format_for_terminal(data)
    print(text)

    if OUTPUT_FILE:
        with open(OUTPUT_FILE, "w") as f:
            json.dump(data, f, indent=2)

    # Exit code signals alerts
    if data["alerts"]:
        sys.exit(42)  # Special exit code = alerts fired
