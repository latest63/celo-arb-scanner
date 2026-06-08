'use client'

import { useEffect, useState, useCallback } from 'react'
import { scanAll, type ScanResult, TOKENS } from '@/lib/scanner'

// Expected FX rates for peg deviation
const FX_EXPECTED: Record<string, number> = {
  KESm: 0.00768, NGNm: 0.00065, GHSm: 0.0685, ZARm: 0.0535,
  PHPm: 0.0173, XOFm: 0.00168, BRLm: 0.194, EURm: 1.15, GBPm: 1.35,
}

function SpreadBadge({ pct }: { pct: number }) {
  const color = pct > 0.1 ? 'bg-red-500/20 text-red-400' :
                pct > 0.01 ? 'bg-yellow-500/20 text-yellow-400' :
                             'bg-green-500/20 text-green-400'
  const icon = pct > 0.1 ? '🔴' : pct > 0.01 ? '🟡' : '🟢'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono ${color}`}>
      {icon} {pct > 0 ? '+' : ''}{pct.toFixed(4)}%
    </span>
  )
}

function AlertBanner({ count }: { count: number }) {
  if (count === 0) return null
  const color = count > 2 ? 'bg-red-600' : 'bg-yellow-600'
  return (
    <div className={`${color} text-white px-4 py-3 rounded-lg mb-4 flex items-center gap-2 animate-pulse`}>
      <span className="text-xl">🚨</span>
      <span className="font-semibold">{count} actionable opportunity{count > 1 ? 'ies' : 'y'} detected</span>
    </div>
  )
}

function TokenPairRow({ pair, rates }: { pair: string; rates: { source: string; rate: number }[] }) {
  const [base, quote] = pair.split('/')
  const expected = FX_EXPECTED[base]
  const best = rates.reduce((a, b) => a.rate > b.rate ? a : b)
  const dev = expected ? ((best.rate / expected) - 1) * 100 : null
  return (
    <div className="card flex items-center justify-between">
      <div>
        <span className="text-sm text-gray-400">{pair}</span>
        {dev !== null && (
          <span className={`ml-2 text-xs font-mono ${
            Math.abs(dev) > 1 ? 'text-red-400' : Math.abs(dev) > 0.1 ? 'text-yellow-400' : 'text-green-400'
          }`}>
            {dev > 0 ? '+' : ''}{dev.toFixed(2)}% vs peg
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {rates.slice(0, 3).map(r => (
          <span key={r.source} className="text-sm font-mono text-gray-300">
            <span className="text-xs text-gray-500">{r.source.split('-')[1] || r.source}</span>{' '}
            {r.rate.toFixed(6)}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  const [data, setData] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await scanAll()
      setData(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    if (!autoRefresh) return
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData, autoRefresh])

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span className="text-celo">◈</span> Celo Arb Scanner
          </h1>
          <p className="text-sm text-gray-500">
            Cross-stable & triangular arbitrage on Celo
            {data && <span className="ml-2">· Block #{data.block.toLocaleString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="accent-celo"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchData}
            disabled={loading}
            className="refresh-btn px-3 py-1.5 bg-celo/10 text-celo rounded-lg text-sm font-medium
                       hover:bg-celo/20 disabled:opacity-50 transition-all"
          >
            {loading ? (
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 border-2 border-celo border-t-transparent rounded-full animate-spin" />
                Scanning
              </span>
            ) : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {data && <AlertBanner count={data.alerts.length} />}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-celo border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {data && (
        <>
          {/* Alert Details */}
          {data.alerts.length > 0 && (
            <div className="card mb-4 border-yellow-500/30">
              <h2 className="text-sm font-semibold text-yellow-400 mb-3">🚨 Actionable Opportunities</h2>
              <div className="space-y-2">
                {data.alerts.map((a, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-gray-200">
                      {a.type === 'triangular' ? `△ ${a.name}` : `○ ${'pair' in a ? a.pair : a.name} venue arb`}
                    </span>
                    <SpreadBadge pct={a.spreadPct} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All Opportunities */}
          <div className="card mb-4">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">📊 All Opportunities</h2>
            <div className="space-y-1.5">
              {data.opportunities.map((o, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-gray-300">
                    {o.type === 'triangular' ? `△ ${o.name}` : `○ ${'pair' in o ? o.pair : o.name} venue arb`}
                  </span>
                  <SpreadBadge pct={o.spreadPct} />
                </div>
              ))}
            </div>
          </div>

          {/* Key Rates */}
          <div className="grid gap-3">
            <h2 className="text-sm font-semibold text-gray-400">💱 Exchange Rates</h2>
            {Object.entries(data.pairs).map(([pair, rates]) => (
              <TokenPairRow key={pair} pair={pair} rates={rates} />
            ))}
          </div>

          {/* Footer */}
          <div className="mt-6 text-center text-xs text-gray-600">
            Last scan: {new Date(data.timestamp).toLocaleTimeString()} · 
            Refreshes every 30s · Data from Celo mainnet (Uniswap V3)
          </div>
        </>
      )}
    </div>
  )
}
