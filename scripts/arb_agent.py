#!/usr/bin/env python3
"""
Celo Arb Agent — Autonomous arbitrage execution.
Monitors signals and executes trades when spread exceeds threshold.
"""

import os, sys, time, json, hmac, hashlib
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

# ── Config ──
CELO_RPC = os.getenv("CELO_RPC", "https://forno.celo.org")
PRIVATE_KEY = os.getenv("AGENT_PRIVATE_KEY", "")
MIN_SPREAD = float(os.getenv("MIN_SPREAD", "0.05"))  # default 0.05%
ARB_ROUTER = os.getenv("ARB_ROUTER", "")
SLIPPAGE = float(os.getenv("SLIPPAGE", "0.3"))  # 0.3% slippage tolerance

w3 = Web3(Web3.HTTPProvider(CELO_RPC))
w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

# ── Contract Addresses (Celo Mainnet) ──
SWAP_ROUTER = Web3.to_checksum_address("0x5615CDAb10dc425a742d643d949a7F474C01abc4")
UNI_FACTORY = Web3.to_checksum_address("0xAfE208a311B21f13EF87E33A90049fC17A7acDEc")

TOKENS = {
    "USDm":  "0x765DE816845861e75A25fCA122bb6898B8B1282a",
    "EURm":  "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73",
    "BRLm":  "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787",
    "KESm":  "0x456a3D042C0DbD3db53D5489e98dFb038553B0d0",
    "NGNm":  "0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71",
    "GHSm":  "0xfAeA5F3404bbA20D3cc2f8C4B0A888F55a3c7313",
    "USDC":  "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    "USDT":  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
}

# ── ABIs ──
ARB_ROUTER_ABI = [
    {"inputs":[{"name":"tokenIn","type":"address"},{"name":"tokenOut","type":"address"},{"name":"fee","type":"uint24"},{"name":"amountIn","type":"uint256"},{"name":"amountOutMin","type":"uint256"},{"name":"sqrtPriceLimitX96","type":"uint160"}],"name":"swap","outputs":[{"name":"amountOut","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"name":"token","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"owner","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
]

ERC20_ABI = [
    {"constant":True,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"type":"function"},
    {"constant":True,"inputs":[{"name":"_owner","type":"address"}],"name":"balanceOf","outputs":[{"name":"balance","type":"uint256"}],"type":"function"},
]

# Pool read ABIs
FACTORY_ABI = [{"inputs":[{"name":"token0","type":"address"},{"name":"token1","type":"address"},{"name":"fee","type":"uint24"}],"name":"getPool","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"}]
POOL_ABI = [
    {"inputs":[],"name":"slot0","outputs":[{"name":"sqrtPriceX96","type":"uint160"},{"name":"tick","type":"int24"},{"name":"observationIndex","type":"uint16"},{"name":"observationCardinality","type":"uint16"},{"name":"observationCardinalityNext","type":"uint16"},{"name":"feeProtocol","type":"uint8"},{"name":"unlocked","type":"bool"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"token0","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"token1","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
]


@dataclass
class Opportunity:
    opp_type: str  # 'triangular' or 'venue'
    name: str
    spread_pct: float
    legs: list
    profit_pct: float

    def is_profitable(self, threshold: float) -> bool:
        return self.spread_pct >= threshold


class Scanner:
    """Lightweight on-chain scanner (same logic as frontend)."""
    
    def __init__(self):
        self.factory = w3.eth.contract(address=UNI_FACTORY, abi=FACTORY_ABI)
    
    def sqrt_to_rate(self, sqrtX96, p0, p1, d0, d1):
        price = (sqrtX96 / 2**96) ** 2
        return price * (10**d0) / (10**d1)
    
    def get_pool_rate(self, t0, t1, fee):
        try:
            addr = self.factory.functions.getPool(Web3.to_checksum_address(t0), Web3.to_checksum_address(t1), fee).call()
            if addr == "0x0000000000000000000000000000000000000000": return None
            pool = w3.eth.contract(address=addr, abi=POOL_ABI)
            s0 = pool.functions.slot0().call()
            p0, p1 = pool.functions.token0().call(), pool.functions.token1().call()
            addr_lower = lambda a: a.lower()
            d = lambda a: {v.lower(): k for k, v in TOKENS.items()}.get(a.lower(), None)
            
            def get_dec(a):
                for sym, addr in TOKENS.items():
                    if addr.lower() == a.lower():
                        if sym in ("USDC", "USDT"): return 6
                        return 18
                return 18
            
            d0, d1 = get_dec(p0), get_dec(p1)
            rate = self.sqrt_to_rate(s0[0], p0, p1, d0, d1)
            if p0.lower() == t0.lower():
                return rate
            else:
                return 1.0 / rate
        except:
            return None
    
    def scan_pair(self, t0, t1):
        rates = []
        for fee in [100, 500, 3000]:
            r = self.get_pool_rate(t0, t1, fee)
            if r and 0 < r < 1e6:
                rates.append({"source": f"UniV3-{fee}bps", "rate": r})
        return sorted(rates, key=lambda x: x["rate"])
    
    def scan(self) -> list:
        """Scan for opportunities. Returns list of Opportunity objects."""
        usdm = TOKENS["USDm"]
        usdc = TOKENS["USDC"]
        opps = []
        
        # Triangular arb
        triangles = [
            ("KESm->USDm->EURm->KESm", TOKENS["KESm"], usdm, TOKENS["EURm"], TOKENS["KESm"]),
            ("USDC->USDm->EURm->USDC", usdc, usdm, TOKENS["EURm"], usdc),
            ("BRLm->USDm->EURm->BRLm", TOKENS["BRLm"], usdm, TOKENS["EURm"], TOKENS["BRLm"]),
        ]
        for name, a, b, c, d in triangles:
            parts = name.split("->")
            l1 = self.scan_pair(a, b)
            l2 = self.scan_pair(b, c)
            l3 = self.scan_pair(c, d)
            r1 = max([x["rate"] for x in l1]) if l1 else 0
            r2 = max([x["rate"] for x in l2]) if l2 else 0
            r3 = max([x["rate"] for x in l3]) if l3 else 0
            if r1 > 0 and r2 > 0 and r3 > 0:
                product = r1 * r2 * r3
                spread = (product - 1) * 100
                opps.append(Opportunity(
                    opp_type="triangular", name=name, spread_pct=round(spread, 6),
                    legs=[{"tokenIn": a, "tokenOut": b, "rate": r1},
                          {"tokenIn": b, "tokenOut": c, "rate": r2},
                          {"tokenIn": c, "tokenOut": d, "rate": r3}],
                    profit_pct=round(spread, 4)
                ))
        
        # Venue arb
        for pair_name, t0, t1 in [("USDC/USDm", usdc, usdm), ("USDT/USDm", TOKENS["USDT"], usdm)]:
            qs = self.scan_pair(t0, t1)
            if len(qs) >= 2:
                best = max(qs, key=lambda q: q["rate"])
                worst = min(qs, key=lambda q: q["rate"])
                spread = (best["rate"] / worst["rate"] - 1) * 100
                opps.append(Opportunity(
                    opp_type="venue", name=pair_name, spread_pct=round(spread, 6),
                    legs=[{"tokenIn": t0, "tokenOut": t1, "rate": best["rate"]}],
                    profit_pct=round(spread, 4)
                ))
        
        return sorted(opps, key=lambda o: o.spread_pct, reverse=True)


class Agent:
    """The autonomous trading agent."""
    
    def __init__(self, router_address: str, private_key: str, min_spread: float):
        self.router_address = Web3.to_checksum_address(router_address)
        self.min_spread = min_spread
        self.account = w3.eth.account.from_key(private_key)
        self.address = self.account.address
        self.router = w3.eth.contract(address=self.router_address, abi=ARB_ROUTER_ABI)
        self.scanner = Scanner()
        self.stats = {"scans": 0, "trades": 0, "last_trade": None, "errors": 0}
        
        print(f"🤖 Agent address: {self.address}")
        print(f"📋 ArbRouter: {self.router_address}")
        print(f"📊 Min spread: {self.min_spread}%")
    
    def check_balance(self, token_addr: str) -> float:
        """Check how much of a token the router holds."""
        try:
            bal = self.router.functions.balanceOf(Web3.to_checksum_address(token_addr)).call()
            dec = w3.eth.contract(address=Web3.to_checksum_address(token_addr), abi=ERC20_ABI).functions.decimals().call()
            return bal / 10**dec
        except:
            return 0.0
    
    def execute_swap(self, opp: Opportunity, amount_in_wei: int) -> Optional[str]:
        """Execute a single-leg swap through ArbRouter."""
        try:
            leg = opp.legs[0]
            tx = self.router.functions.swap(
                Web3.to_checksum_address(leg["tokenIn"]),
                Web3.to_checksum_address(leg["tokenOut"]),
                3000,  # 0.3% fee tier (default)
                amount_in_wei,
                int(amount_in_wei * (100 - SLIPPAGE) / 100),  # amountOutMin with slippage
                0,  # sqrtPriceLimitX96
            ).build_transaction({
                "from": self.address,
                "nonce": w3.eth.get_transaction_count(self.address),
                "gas": 300000,
                "maxFeePerGas": w3.eth.gas_price,
                "maxPriorityFeePerGas": w3.eth.gas_price,
            })
            
            signed = self.account.sign_transaction(tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt["status"] == 1:
                self.stats["trades"] += 1
                self.stats["last_trade"] = {
                    "time": datetime.now().isoformat(),
                    "opp": opp.name,
                    "spread": opp.spread_pct,
                    "tx": tx_hash.hex(),
                    "block": receipt["blockNumber"],
                }
                return tx_hash.hex()
            else:
                print(f"  ❌ TX failed: {tx_hash.hex()}")
                return None
                
        except Exception as e:
            print(f"  ❌ Error: {e}")
            self.stats["errors"] += 1
            return None
    
    def run_once(self) -> str:
        """Single scan + execute cycle. Returns status message."""
        self.stats["scans"] += 1
        block = w3.eth.block_number
        now = datetime.now().isoformat()
        
        # Check router balance
        usdc_bal = self.check_balance(TOKENS["USDC"])
        usdt_bal = self.check_balance(TOKENS["USDT"])
        
        # Scan
        opportunities = self.scanner.scan()
        profitable = [o for o in opportunities if o.is_profitable(self.min_spread)]
        
        lines = []
        lines.append(f"\n{'='*60}")
        lines.append(f"🤖 AGENT CYCLE #{self.stats['scans']} | Block {block}")
        lines.append(f"   Balance: {usdc_bal:.2f} USDC | {usdt_bal:.2f} USDT")
        lines.append(f"   Threshold: ≥{self.min_spread}%")
        
        if not profitable:
            best = opportunities[0] if opportunities else None
            if best:
                lines.append(f"   Best spread: {best.spread_pct:.4f}% (below threshold)")
            else:
                lines.append(f"   No opportunities found")
            return "\n".join(lines)
        
        lines.append(f"\n🚨 {len(profitable)} profitable opportunity(ies):")
        
        for opp in profitable:
            lines.append(f"\n  📈 {opp.name}: {opp.spread_pct:+.4f}%")
            
            # Check if we have balance to trade
            first_leg = opp.legs[0]["tokenIn"]
            bal = self.check_balance(first_leg)
            lines.append(f"     Router balance: {bal:.4f}")
            
            if bal < 1.0:
                lines.append(f"     ⏩ Skipping — insufficient balance")
                continue
            
            # Execute
            amount_wei = self._to_wei(first_leg, min(bal * 0.5, 100))  # Use 50% of balance, max 100 units
            if opp.opp_type == "venue":
                lines.append(f"     → Executing swap...")
                tx_hash = self.execute_swap(opp, amount_wei)
                if tx_hash:
                    lines.append(f"     ✅ TX: {tx_hash[:20]}...")
                else:
                    lines.append(f"     ❌ Failed")
        
        self.stats["last_scan"] = now
        return "\n".join(lines)
    
    def _to_wei(self, token_addr: str, amount: float) -> int:
        dec = w3.eth.contract(address=Web3.to_checksum_address(token_addr), abi=ERC20_ABI).functions.decimals().call()
        return int(amount * 10**dec)
    
    def run_loop(self, interval=30):
        """Run agent continuously."""
        print(f"\n{'='*60}")
        print(f"🚀 CELO ARB AGENT STARTED")
        print(f"   Threshold: ≥{self.min_spread}%")
        print(f"   Interval: {interval}s")
        print(f"{'='*60}")
        
        try:
            while True:
                result = self.run_once()
                print(result)
                time.sleep(interval)
        except KeyboardInterrupt:
            print(f"\n🛑 Agent stopped")
            print(f"   Stats: {self.stats}")
            self.save_stats()
    
    def save_stats(self):
        stats_file = os.getenv("AGENT_STATS_FILE", "/tmp/arb_agent_stats.json")
        with open(stats_file, "w") as f:
            json.dump({"stats": self.stats, "timestamp": datetime.now().isoformat()}, f, indent=2)
        print(f"   Stats saved to {stats_file}")


if __name__ == "__main__":
    if not ARB_ROUTER:
        print("❌ ARB_ROUTER not set")
        sys.exit(1)
    if not PRIVATE_KEY:
        print("❌ AGENT_PRIVATE_KEY not set")
        sys.exit(1)
    
    mode = os.getenv("AGENT_MODE", "once")
    agent = Agent(ARB_ROUTER, PRIVATE_KEY, MIN_SPREAD)
    
    if mode == "loop":
        interval = int(os.getenv("AGENT_INTERVAL", "30"))
        agent.run_loop(interval)
    else:
        result = agent.run_once()
        print(result)
        agent.save_stats()
        
        # Exit code signals
        if agent.stats["trades"] > 0:
            sys.exit(42)  # Trades executed
