'use client'

import { useEffect, useState, useCallback } from 'react'

// Expected FX rates for peg deviation display
const FX_EXPECTED: Record<string, number> = {
  KESm: 0.00768, NGNm: 0.00065, GHSm: 0.0685, ZARm: 0.0535,
  PHPm: 0.0173, XOFm: 0.00168, BRLm: 0.194, EURm: 1.15, GBPm: 1.35,
}

interface ScanResult {
  block: number
  timestamp: string
  pairs: Record<string, { source: string; rate: number }[]>
  opportunities: {
    type: string; name: string; spreadPct: number; profitable: boolean
    pair?: string; legs?: number[]; best?: any; worst?: any
  }[]
  alerts: { type: string; name: string; spreadPct: number; profitable: boolean; pair?: string }[]
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
  return (
    <div className="bg-gradient-to-r from-yellow-600/80 to-red-600/80 text-white px-4 py-3 rounded-lg mb-4 flex items-center gap-2 animate-pulse">
      <span className="text-xl">🚨</span>
      <span className="font-semibold">{count} actionable opportunity{count > 1 ? 'ies' : 'y'} detected</span>
    </div>
  )
}

function PairRow({ pair, rates }: { pair: string; rates: { source: string; rate: number }[] }) {
  const [base] = pair.split('/')
  const expected = FX_EXPECTED[base]
  const best = rates.reduce((a, b) => a.rate > b.rate ? a : b)
  const dev = expected ? ((best.rate / expected) - 1) * 100 : null
  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl p-4 flex items-center justify-between">
      <div>
        <span className="text-sm text-gray-400 font-mono">{pair}</span>
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

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/scan')
      if (!res.ok) throw new Error(await res.text())
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      setData(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6" style={{ background: '#0f0f1a', minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span style={{ color: '#35D07F' }}>◈</span> Celo Arb Scanner
          </h1>
          <p className="text-sm" style={{ color: '#6b7280' }}>
            Cross-stable & triangular arbitrage on Celo
            {data && <span className="ml-2">· Block #{data.block.toLocaleString()}</span>}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
          style={{ background: 'rgba(53,208,127,0.1)', color: '#35D07F' }}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Scanning
            </span>
          ) : '⟳ Refresh'}
        </button>
      </div>

      {/* Alerts */}
      {data && <AlertBanner count={data.alerts.length} />}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && !data && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-10 h-10 border-2 border-[#35D07F] border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-gray-500 text-sm">Scanning Celo blockchain...</p>
        </div>
      )}

      {data && (
        <>
          {/* Alert Details */}
          {data.alerts.length > 0 && (
            <div className="bg-[#1a1a2e] border border-yellow-500/30 rounded-xl p-4 mb-4">
              <h2 className="text-sm font-semibold text-yellow-400 mb-3">🚨 Actionable Opportunities</h2>
              <div className="space-y-2">
                {data.alerts.map((a, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-gray-200">
                      {a.type === 'triangular' ? `△ ${a.name}` : `○ ${a.pair || a.name} venue arb`}
                    </span>
                    <SpreadBadge pct={a.spreadPct} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All Opportunities */}
          <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl p-4 mb-4">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">📊 All Opportunities</h2>
            <div className="space-y-1.5">
              {data.opportunities.length === 0 && (
                <p className="text-gray-600 text-sm">No arbitrage windows detected this scan</p>
              )}
              {data.opportunities.map((o, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-gray-300">
                    {o.type === 'triangular' ? `△ ${o.name}` : `○ ${o.pair || o.name} venue arb`}
                  </span>
                  <SpreadBadge pct={o.spreadPct} />
                </div>
              ))}
            </div>
          </div>

          {/* Key Rates */}
          <div className="grid gap-3">
            <h2 className="text-sm font-semibold text-gray-400">💱 Exchange Rates</h2>
            {Object.entries(data.pairs).length === 0 && (
              <p className="text-gray-600 text-sm">No rates returned from scan</p>
            )}
            {Object.entries(data.pairs).map(([pair, rates]) => (
              <PairRow key={pair} pair={pair} rates={rates} />
            ))}
          </div>

          {/* Footer */}
          <div className="mt-6 text-center text-xs" style={{ color: '#4b5563' }}>
            Last scan: {new Date(data.timestamp).toLocaleTimeString()} · Refreshes every 30s · Data from Celo mainnet
          </div>
        </>
      )}
    </div>
  )
}
