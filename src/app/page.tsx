'use client'

import { useEffect, useState, useCallback } from 'react'

interface ScanResult {
  block: number
  timestamp: string
  pairs: Record<string, { source: string; rate: number }[]>
  opportunities: {
    type: string; name: string; spreadPct: number; profitable: boolean
    pair?: string; legs?: number[]
  }[]
  alerts: { type: string; name: string; spreadPct: number; profitable: boolean; pair?: string }[]
}

const FX_EXPECTED: Record<string, number> = {
  KESm: 0.00768, NGNm: 0.00065, GHSm: 0.0685, ZARm: 0.0535,
  PHPm: 0.0173, XOFm: 0.00168, BRLm: 0.194, EURm: 1.15, GBPm: 1.35,
}

function spreadClass(pct: number): string {
  if (pct > 0.1) return 'high'
  if (pct > 0.01) return 'medium'
  return 'low'
}

function formatSpread(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(4)}%`
}

export default function Home() {
  const [data, setData] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTicker, setActiveTicker] = useState<string | null>(null)

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

  const tickerSymbols = ['KESm/USDm', 'XOFm/USDm', 'BRLm/USDm', 'EURm/USDm', 'USDC/USDm', 'USDT/USDm', 'GBPm/USDm', 'NGNm/USDm', 'GHSm/USDm', 'ZARm/USDm']

  return (
    <div className="app-container">
      {/* Header */}
      <div className="app-header">
        <div className="app-brand">
          <div className="app-logo">◈</div>
          <h1>Celo Arb</h1>
          <span className="version">v1</span>
          {data && (
            <span className="app-meta">
              <span>#{data.block.toLocaleString()}</span>
              <span>|</span>
              <span>{Object.keys(data.pairs).length}p</span>
            </span>
          )}
        </div>
        <button className="btn-refresh" onClick={fetchData} disabled={loading}>
          {loading && <span className="loading-spinner" style={{ width: 10, height: 10, borderWidth: 1.5, display: 'inline-block' }} />}
          {loading ? '…' : '⟳'}
        </button>
      </div>

      {/* Ticker */}
      {data && (
        <div className="ticker-bar">
          {tickerSymbols.map(sym => {
            const rates = data.pairs[sym]
            if (!rates || rates.length === 0) return null
            const best = rates.reduce((a, b) => a.rate > b.rate ? a : b)
            const [base] = sym.split('/')
            const expected = FX_EXPECTED[base]
            const dev = expected ? ((best.rate / expected) - 1) * 100 : null
            const devClass = dev && Math.abs(dev) > 0.1 ? (dev > 0 ? 'gain' : 'loss') : ''
            return (
              <div
                key={sym}
                className={`ticker-item ${activeTicker === sym ? 'active' : ''}`}
                onClick={() => setActiveTicker(activeTicker === sym ? null : sym)}
              >
                <span className="ticker-symbol">{sym.split('/')[0]}</span>
                <span style={{ color: 'var(--text-primary)' }}>{best.rate.toFixed(6)}</span>
                {dev !== null && (
                  <span className={`data-value ${devClass}`} style={{ fontSize: 11 }}>
                    {dev > 0 ? '+' : ''}{dev.toFixed(2)}%
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="panel" style={{ borderColor: 'var(--color-loss)', marginBottom: 'var(--sp-4)' }}>
          <div className="panel-body" style={{ padding: 'var(--sp-3)', color: 'var(--color-loss)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            ERR: {error}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="loading-screen">
          <div className="loading-spinner" />
          <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 13, letterSpacing: '0.05em' }}>
            SCANNING CELO
          </span>
        </div>
      )}

      {data && (
        <>
          {/* Alerts */}
          {data.alerts.length > 0 && (
            <div className="alert-banner">
              <span style={{ fontWeight: 600 }}>{data.alerts.length} SIGNAL{data.alerts.length > 1 ? 'S' : ''}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 'inherit' }}>
                {data.alerts.map(a => a.type === 'triangular' ? a.name : a.pair || a.name).join(' · ')}
              </span>
            </div>
          )}

          {/* Panels */}
          <div className="split-panels">
            {/* Left: Opportunities */}
            <div className="panel" style={{ border: 'none' }}>
              <div className="panel-header">
                <span>Opportunities</span>
                <span className="data-value neutral" style={{ fontSize: 11 }}>
                  {data.opportunities.filter(o => o.spreadPct > 0).length} active
                </span>
              </div>
              <div className="opp-scroll">
                {data.opportunities.length === 0 && (
                  <div className="data-row" style={{ justifyContent: 'center', color: 'var(--text-tertiary)' }}>
                    No arb windows
                  </div>
                )}
                {data.opportunities.map((o, i) => (
                  <div key={i} className={`opp-item ${o.spreadPct >= 0.01 ? 'alert' : ''}`}>
                    <div className="opp-name">
                      <span className={`indicator ${o.type === 'triangular' ? 'tri' : 'venue'}`}>
                        {o.type === 'triangular' ? '△' : '○'}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {o.type === 'triangular' ? o.name : (o.pair || o.name)}
                      </span>
                    </div>
                    <span className={`spread-badge ${spreadClass(o.spreadPct)}`}>
                      {formatSpread(o.spreadPct)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Rates */}
            <div className="panel" style={{ border: 'none', borderLeft: '1px solid var(--border-default)' }}>
              <div className="panel-header">
                <span>Rates</span>
                <span className="data-value neutral" style={{ fontSize: 11 }}>
                  {Object.keys(data.pairs).length} pairs
                </span>
              </div>
              <div className="opp-scroll">
                {Object.entries(data.pairs).map(([pair, rates]) => {
                  const [base] = pair.split('/')
                  const expected = FX_EXPECTED[base]
                  const best = rates.reduce((a, b) => a.rate > b.rate ? a : b)
                  const dev = expected ? ((best.rate / expected) - 1) * 100 : null
                  return (
                    <div key={pair} className="data-row">
                      <span className="data-label">{pair}</span>
                      <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {rates.slice(0, 2).map(r => (
                          <span key={r.source} className="data-value" style={{ fontSize: 12 }}>
                            <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>{r.source.split('-')[1]}</span>
                            {' '}{r.rate.toFixed(6)}
                          </span>
                        ))}
                        {dev !== null && (
                          <span className={`data-value ${
                            Math.abs(dev) > 0.1 ? (dev > 0 ? 'gain' : 'loss') : 'neutral'
                          }`} style={{ fontSize: 11, minWidth: 48, textAlign: 'right' }}>
                            {dev > 0 ? '+' : ''}{dev.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Ticker Detail */}
          {activeTicker && data.pairs[activeTicker] && (
            <div className="panel" style={{ marginTop: 'var(--sp-4)' }}>
              <div className="panel-header">{activeTicker} — Fee Tiers</div>
              <div className="detail-grid">
                {data.pairs[activeTicker].map(r => (
                  <div key={r.source} className="detail-cell">
                    <div className="label">{r.source}</div>
                    <div className="value">{r.rate.toFixed(6)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status */}
          <div className="status-bar">
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="status-dot" />
              <span>LIVE</span>
              <span style={{ margin: '0 var(--sp-3)', color: 'var(--border-accent)' }}>|</span>
              <span>30s</span>
              <span style={{ margin: '0 var(--sp-3)', color: 'var(--border-accent)' }}>|</span>
              <span>CELO</span>
            </div>
            <div>{data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '—'}</div>
          </div>
        </>
      )}
    </div>
  )
}
