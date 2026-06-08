# Celo Cross-Stable Arbitrage Scanner

Real-time arbitrage scanner for Celo's cross-stable and local-currency opportunities.

Tracks live rates across Uniswap V3 for triangular arb and venue arb between Mento stablecoins (KESm, NGNm, GHSm, XOFm, BRLm, EURm, etc.) and major stables (USDC, USDT).

## Setup

```bash
pip install web3 requests
```

## Usage

```bash
# Single scan
python3 arb_scanner.py

# Set alert threshold (default 0.01%)
MIN_SPREAD=0.05 python3 arb_scanner.py

# Output to JSON file
OUTPUT_FILE=scan.json python3 arb_scanner.py
```

Exit code 42 = alerts fired (spread above threshold).
