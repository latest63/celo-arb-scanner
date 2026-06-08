// Server-side scanner API — reads Celo RPC from Vercel's backend
import { NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { celo } from 'viem/chains'

const client = createPublicClient({
  chain: celo,
  transport: http('https://forno.celo.org', { timeout: 15_000 }),
})

const TOKENS: Record<string, { symbol: string; address: `0x${string}`; decimals: number }> = {
  USDm: { symbol: 'USDm', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 },
  EURm: { symbol: 'EURm', address: '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73', decimals: 18 },
  BRLm: { symbol: 'BRLm', address: '0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787', decimals: 18 },
  KESm: { symbol: 'KESm', address: '0x456a3D042C0DbD3db53D5489e98dFb038553B0d0', decimals: 18 },
  NGNm: { symbol: 'NGNm', address: '0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71', decimals: 18 },
  GHSm: { symbol: 'GHSm', address: '0xfAeA5F3404bbA20D3cc2f8C4B0A888F55a3c7313', decimals: 18 },
  XOFm: { symbol: 'XOFm', address: '0x73F93dcc49cB8A239e2032663e9475dd5ef29A08', decimals: 18 },
  ZARm: { symbol: 'ZARm', address: '0x4c35853A3B4e647fD266f4de678dCc8fEC410BF6', decimals: 18 },
  PHPm: { symbol: 'PHPm', address: '0x105d4A9306D2E55a71d2Eb95B81553AE1dC20d7B', decimals: 18 },
  GBPm: { symbol: 'GBPm', address: '0xCCF663b1fF11028f0b19058d0f7B674004a40746', decimals: 18 },
  USDC: { symbol: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
  USDT: { symbol: 'USDT', address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
}

const FACTORY_ABI = [{ inputs: [{ name: 'token0', type: 'address' }, { name: 'token1', type: 'address' }, { name: 'fee', type: 'uint24' }], name: 'getPool', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' }] as const
const POOL_ABI = [{ inputs: [], name: 'slot0', outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' }, { name: 'observationIndex', type: 'uint16' }, { name: 'observationCardinality', type: 'uint16' }, { name: 'observationCardinalityNext', type: 'uint16' }, { name: 'feeProtocol', type: 'uint8' }, { name: 'unlocked', type: 'bool' }], stateMutability: 'view', type: 'function' }, { inputs: [], name: 'token0', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' }, { inputs: [], name: 'token1', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' }, { inputs: [], name: 'liquidity', outputs: [{ name: '', type: 'uint128' }], stateMutability: 'view', type: 'function' }] as const

const UNI_FACTORY = '0xAfE208a311B21f13EF87E33A90049fC17A7acDEc' as const

function sqrtToRate(sqrtX96: bigint, d0: number, d1: number): number {
  return ((Number(sqrtX96) / 2 ** 96) ** 2 * 10 ** d0) / 10 ** d1
}

async function findPool(t0: `0x${string}`, t1: `0x${string}`, fee: number) {
  try {
    const addr = await client.readContract({ address: UNI_FACTORY, abi: FACTORY_ABI, functionName: 'getPool', args: [t0, t1, fee] })
    if (addr === '0x0000000000000000000000000000000000000000') return null
    const [slot0, p0, p1] = await Promise.all([
      client.readContract({ address: addr, abi: POOL_ABI, functionName: 'slot0' }),
      client.readContract({ address: addr, abi: POOL_ABI, functionName: 'token0' }),
      client.readContract({ address: addr, abi: POOL_ABI, functionName: 'token1' }),
    ])
    const gd = (a: string) => Object.values(TOKENS).find(t => t.address.toLowerCase() === a.toLowerCase())?.decimals ?? 18
    const raw = sqrtToRate(slot0[0], gd(p0), gd(p1))
    return p0.toLowerCase() === t0.toLowerCase() ? raw : 1 / raw
  } catch { return null }
}

async function scanPair(pair: string, t0: `0x${string}`, t1: `0x${string}`) {
  const results: { source: string; rate: number }[] = []
  for (const fee of [100, 500, 3000]) {
    const r = await findPool(t0, t1, fee)
    if (r && r > 0 && r < 1e6) results.push({ source: `UniV3-${fee}bps`, rate: Number(r.toFixed(8)) })
  }
  return results.sort((a, b) => a.rate - b.rate)
}

export async function GET() {
  try {
    const block = await client.getBlockNumber()
    const ts = new Date().toISOString()
    const usdm = TOKENS.USDm.address, usdc = TOKENS.USDC.address
    const pairs: Record<string, { source: string; rate: number }[]> = {}
    const opps: any[] = []

    // Local stables
    for (const sym of ['KESm', 'NGNm', 'GHSm', 'ZARm', 'PHPm', 'XOFm', 'BRLm', 'EURm', 'GBPm'] as const) {
      const qs = await scanPair(`${sym}/USDm`, TOKENS[sym].address, usdm)
      if (qs.length) pairs[`${sym}/USDm`] = qs
    }

    // Major pairs
    for (const [name, t0, t1] of [
      ['EURm/USDm', TOKENS.EURm.address, usdm], ['GBPm/USDm', TOKENS.GBPm.address, usdm],
      ['USDC/USDm', usdc, usdm], ['USDT/USDm', TOKENS.USDT.address, usdm], ['EURm/USDC', TOKENS.EURm.address, usdc],
    ] as const) {
      const qs = await scanPair(name, t0, t1)
      if (qs.length) pairs[name] = qs
    }

    // Triangles
    for (const [name, a, b, c, d] of [
      ['KESm->USDm->EURm->KESm', TOKENS.KESm.address, usdm, TOKENS.EURm.address, TOKENS.KESm.address],
      ['USDC->USDm->EURm->USDC', usdc, usdm, TOKENS.EURm.address, usdc],
      ['BRLm->USDm->EURm->BRLm', TOKENS.BRLm.address, usdm, TOKENS.EURm.address, TOKENS.BRLm.address],
      ['NGNm->USDm->KESm->NGNm', TOKENS.NGNm.address, usdm, TOKENS.KESm.address, TOKENS.NGNm.address],
    ] as const) {
      const parts = name.split('->')
      const [l1, l2, l3] = await Promise.all([
        scanPair(`${parts[0]}/${parts[1]}`, a, b),
        scanPair(`${parts[1]}/${parts[2]}`, b, c),
        scanPair(`${parts[2]}/${parts[3]}`, c, d),
      ])
      const r1 = l1.length ? Math.max(...l1.map(q => q.rate)) : 0
      const r2 = l2.length ? Math.max(...l2.map(q => q.rate)) : 0
      const r3 = l3.length ? Math.max(...l3.map(q => q.rate)) : 0
      if (r1 > 0 && r2 > 0 && r3 > 0) {
        const spread = (r1 * r2 * r3 - 1) * 100
        opps.push({ type: 'triangular', name, spreadPct: Number(spread.toFixed(6)), profitable: spread > 0, legs: [r1, r2, r3] })
      }
    }

    // Venue arb
    for (const [pair, t0, t1] of [['USDC/USDm', usdc, usdm], ['USDT/USDm', TOKENS.USDT.address, usdm], ['EURm/USDm', TOKENS.EURm.address, usdm]] as const) {
      const qs = await scanPair(pair, t0, t1)
      if (qs.length >= 2) {
        const best = qs.reduce((a, b) => a.rate > b.rate ? a : b)
        const worst = qs.reduce((a, b) => a.rate < b.rate ? a : b)
        const spread = (best.rate / worst.rate - 1) * 100
        opps.push({ type: 'venue_arb', name: pair, pair, spreadPct: Number(spread.toFixed(6)), profitable: spread > 0, best, worst })
      }
    }

    return NextResponse.json({
      block: Number(block),
      timestamp: ts,
      pairs,
      opportunities: opps,
      alerts: opps.filter((o: any) => o.spreadPct >= 0.01),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
