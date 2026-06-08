#!/usr/bin/env python3
"""
Celo Arb Agent — Autonomous arbitrage execution.
Reads config from agent_config.json, writes status to agent_stats.json.
Supports live config reload for frontend control.
"""

import os, sys, time, json, signal
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

# ── Paths ──
BASE_DIR = os.getenv("AGENT_DIR", "/opt/celo-arb-agent")
CONFIG_FILE = os.path.join(BASE_DIR, "agent_config.json")
STATS_FILE = os.path.join(BASE_DIR, "agent_stats.json")
CONTROL_FILE = os.path.join(BASE_DIR, "agent.control")

# ── Default Config ──
DEFAULT_CONFIG = {
    "enabled": True,
    "min_spread": 0.05,
    "slippage": 0.3,
    "interval": 30,
    "max_trade_size": 100,
    "trade_fraction": 0.5,
}

# ── Token Registry (Celo Mainnet) ──
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

SWAP_ROUTER = Web3.to_checksum_address("0x5615CDAb10dc425a742d643d949a7F474C01abc4")
UNI_FACTORY = Web3.to_checksum_address("0xAfE208a311B21f13EF87E33A90049fC17A7acDEc")

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
FACTORY_ABI = [{"inputs":[{"name":"token0","type":"address"},{"name":"token1","type":"address"},{"name":"fee","type":"uint24"}],"name":"getPool","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"}]
POOL_ABI = [
    {"inputs":[],"name":"slot0","outputs":[{"name":"sqrtPriceX96","type":"uint160"},{"name":"tick","type":"int24"},{"name":"observationIndex","type":"uint16"},{"name":"observationCardinality","type":"uint16"},{"name":"observationCardinalityNext","type":"uint16"},{"name":"feeProtocol","type":"uint8"},{"name":"unlocked","type":"bool"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"token0","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
    {"inputs":[],"name":"token1","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"},
]


@dataclass
class Opportunity:
    opp_type: str
    name: str
    spread_pct: float
    legs: list
    profit_pct: float

    def is_profitable(self, threshold: float) -> bool:
        return self.spread_pct >= threshold


class Config:
    """Live config reader — reloads from file each cycle."""
    def __init__(self):
        self._cache = dict(DEFAULT_CONFIG)
        self._mtime = 0

    def _reload(self):
        try:
            mtime = os.path.getmtime(CONFIG_FILE)
            if mtime <= self._mtime:
                return
            with open(CONFIG_FILE) as f:
                data = json.load(f)
            self._cache.update(data)
            self._mtime = mtime
        except (FileNotFoundError, json.JSONDecodeError):
            pass

    def get(self, key, default=None):
        self._reload()
        return self._cache.get(key, default)

    def get_all(self):
        self._reload()
        return dict(self._cache)


class Scanner:
    def __init__(self):
        self.w3 = Web3(Web3.HTTPProvider(os.getenv("CELO_RPC", "https://forno.celo.org")))
        self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        self.factory = self.w3.eth.contract(address=UNI_FACTORY, abi=FACTORY_ABI)

    def sqrt_to_rate(self, sqrtX96, d0, d1):
        price = (sqrtX96 / 2**96) ** 2
        return price * (10**d0) / (10**d1)

    def get_pool_rate(self, t0, t1, fee):
        try:
            addr = self.factory.functions.getPool(Web3.to_checksum_address(t0), Web3.to_checksum_address(t1), fee).call()
            if addr == "0x0000000000000000000000000000000000000000": return None
            pool = self.w3.eth.contract(address=addr, abi=POOL_ABI)
            s0 = pool.functions.slot0().call()
            p0, p1 = pool.functions.token0().call(), pool.functions.token1().call()
            sym_of = {v.lower(): k for k, v in TOKENS.items()}
            def get_dec(a):
                for sym, addr in TOKENS.items():
                    if addr.lower() == a.lower():
                        return 6 if sym in ("USDC", "USDT") else 18
                return 18
            d0, d1 = get_dec(p0), get_dec(p1)
            rate = self.sqrt_to_rate(s0[0], d0, d1)
            return rate if p0.lower() == t0.lower() else 1.0 / rate
        except:
            return None

    def scan_pair(self, t0, t1):
        rates = []
        for fee in [100, 500, 3000]:
            r = self.get_pool_rate(t0, t1, fee)
            if r and 0 < r < 1e6:
                rates.append({"source": f"UniV3-{fee}bps", "rate": r})
        return sorted(rates, key=lambda x: x["rate"])

    def scan(self):
        usdm, usdc = TOKENS["USDm"], TOKENS["USDC"]
        opps = []
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
                spread = (r1 * r2 * r3 - 1) * 100
                opps.append(Opportunity("triangular", name, round(spread, 6),
                    [{"tokenIn": a, "tokenOut": b, "rate": r1},
                     {"tokenIn": b, "tokenOut": c, "rate": r2},
                     {"tokenIn": c, "tokenOut": d, "rate": r3}], round(spread, 4)))
        for pair_name, t0, t1 in [("USDC/USDm", usdc, usdm), ("USDT/USDm", TOKENS["USDT"], usdm)]:
            qs = self.scan_pair(t0, t1)
            if len(qs) >= 2:
                best = max(qs, key=lambda q: q["rate"])
                worst = min(qs, key=lambda q: q["rate"])
                spread = (best["rate"] / worst["rate"] - 1) * 100
                opps.append(Opportunity("venue", pair_name, round(spread, 6),
                    [{"tokenIn": t0, "tokenOut": t1, "rate": best["rate"]}], round(spread, 4)))
        return sorted(opps, key=lambda o: o.spread_pct, reverse=True)


class Agent:
    def __init__(self, router_address: str, private_key: str):
        self.w3 = Web3(Web3.HTTPProvider(os.getenv("CELO_RPC", "https://forno.celo.org")))
        self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        self.router_address = Web3.to_checksum_address(router_address)
        self.account = self.w3.eth.account.from_key(private_key)
        self.address = self.account.address
        self.router = self.w3.eth.contract(address=self.router_address, abi=ARB_ROUTER_ABI)
        self.scanner = Scanner()
        self.config = Config()
        self.stats = {"scans": 0, "trades": 0, "errors": 0, "last_trade": None, "started_at": datetime.now().isoformat()}
        self._running = True

    def check_balance(self, token_addr: str) -> float:
        try:
            bal = self.router.functions.balanceOf(Web3.to_checksum_address(token_addr)).call()
            if bal == 0: return 0.0
            dec = self.w3.eth.contract(address=Web3.to_checksum_address(token_addr), abi=ERC20_ABI).functions.decimals().call()
            return bal / 10**dec
        except:
            return 0.0

    def execute_swap(self, opp: Opportunity, amount_in_wei: int) -> Optional[str]:
        try:
            leg = opp.legs[0]
            slip = self.config.get("slippage", 0.3)
            tx = self.router.functions.swap(
                Web3.to_checksum_address(leg["tokenIn"]),
                Web3.to_checksum_address(leg["tokenOut"]),
                3000,
                amount_in_wei,
                int(amount_in_wei * (100 - slip) / 100),
                0,
            ).build_transaction({
                "from": self.address,
                "nonce": self.w3.eth.get_transaction_count(self.address),
                "gas": 300000,
                "maxFeePerGas": self.w3.eth.gas_price,
                "maxPriorityFeePerGas": self.w3.eth.gas_price,
            })
            signed = self.account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
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
            return None
        except Exception as e:
            print(f"  ❌ Swap error: {e}")
            self.stats["errors"] += 1
            return None

    def run_once(self) -> dict:
        self.stats["scans"] += 1
        block = self.w3.eth.block_number
        now = datetime.now().isoformat()

        cfg = self.config.get_all()
        min_spread = cfg.get("min_spread", 0.05)
        enabled = cfg.get("enabled", True)

        # Check balances
        usdc_bal = self.check_balance(TOKENS["USDC"])
        usdt_bal = self.check_balance(TOKENS["USDT"])

        opportunities = self.scanner.scan()
        profitable = [o for o in opportunities if o.is_profitable(min_spread)]

        result = {
            "block": block,
            "timestamp": now,
            "config": cfg,
            "balances": {"USDC": round(usdc_bal, 2), "USDT": round(usdt_bal, 2)},
            "opportunities": [],
            "trades_executed": 0,
        }

        if not profitable:
            best = opportunities[0] if opportunities else None
            result["best_spread"] = best.spread_pct if best else 0
            self._save_stats()
            return result

        for opp in profitable:
            entry = {
                "name": opp.name,
                "type": opp.opp_type,
                "spread": opp.spread_pct,
            }
            if enabled:
                first_leg = opp.legs[0]["tokenIn"]
                bal = self.check_balance(first_leg)
                entry["balance"] = round(bal, 4)
                if bal >= 1.0:
                    trade_frac = cfg.get("trade_fraction", 0.5)
                    max_size = cfg.get("max_trade_size", 100)
                    amount = min(bal * trade_frac, max_size)
                    amount_wei = self._to_wei(first_leg, amount)
                    tx_hash = self.execute_swap(opp, amount_wei)
                    if tx_hash:
                        entry["executed"] = True
                        entry["tx"] = tx_hash[:20] + "..."
                        result["trades_executed"] += 1
                    else:
                        entry["executed"] = False
                else:
                    entry["skipped"] = "low balance"
            result.setdefault("opportunities", []).append(entry)

        self._save_stats()
        return result

    def _to_wei(self, token_addr: str, amount: float) -> int:
        dec = self.w3.eth.contract(address=Web3.to_checksum_address(token_addr), abi=ERC20_ABI).functions.decimals().call()
        return int(amount * 10**dec)

    def _save_stats(self):
        self.stats["last_update"] = datetime.now().isoformat()
        try:
            with open(STATS_FILE, "w") as f:
                json.dump(self.stats, f, indent=2)
        except Exception as e:
            print(f"  ⚠️ Stats save error: {e}")

    def _check_control(self):
        """Check for control signals from the API."""
        try:
            if os.path.exists(CONTROL_FILE):
                with open(CONTROL_FILE) as f:
                    cmd = f.read().strip()
                os.remove(CONTROL_FILE)
                if cmd == "STOP":
                    self._running = False
                    print("  🛑 Stop signal received")
                elif cmd == "RELOAD":
                    self.config._mtime = 0  # Force reload
                    print("  🔄 Config reload signal received")
        except:
            pass

    def run_loop(self):
        print(f"\n{'='*60}")
        print(f"🚀 CELO ARB AGENT STARTED")
        print(f"   Address: {self.address}")
        print(f"   Router: {self.router_address}")
        print(f"   Config: {CONFIG_FILE}")
        print(f"   Stats:  {STATS_FILE}")
        print(f"{'='*60}")

        self._save_stats()

        while self._running:
            self._check_control()
            if not self._running:
                break

            cfg = self.config.get_all()
            if not cfg.get("enabled", True):
                time.sleep(5)
                continue

            interval = cfg.get("interval", 30)
            result = self.run_once()
            trade_count = result.get("trades_executed", 0)
            spread_str = f"best={result.get('best_spread', '?')}%" if "best_spread" in result else f"trades={trade_count}"
            ts = result.get("timestamp", datetime.now().isoformat())[11:19]
            print(f"  [{ts}] block #{result['block']} | {spread_str}")
            sys.stdout.flush()
            time.sleep(interval)

        print(f"\n🛑 Agent stopped. Stats: {self.stats['scans']} scans, {self.stats['trades']} trades")


def main():
    router = os.getenv("ARB_ROUTER", "")
    pk = os.getenv("AGENT_PRIVATE_KEY", "")
    if not router or not pk:
        print("❌ ARB_ROUTER and AGENT_PRIVATE_KEY must be set")
        sys.exit(1)

    agent = Agent(router, pk)
    mode = os.getenv("AGENT_MODE", "once")

    if mode == "loop":
        agent.run_loop()
    else:
        result = agent.run_once()
        print(json.dumps(result, indent=2))
        agent._save_stats()


if __name__ == "__main__":
    main()
