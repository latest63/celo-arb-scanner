# Celo Arb Scanner

Real-time cross-stable and triangular arbitrage scanner for Celo.

**Frontend:** Next.js dashboard showing live rates and opportunities  
**Scanner:** Python CLI tool for continuous polling

## Deploy

```bash
# Frontend
npm install && npm run build

# Scanner
pip install web3 requests
python3 scripts/arb_scanner.py
```

## Stack
- Next.js 16 + Tailwind v4 + viem
- Celo mainnet (Uniswap V3 pools)
- Mento local-currency stables
