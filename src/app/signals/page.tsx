'use client'

import { useEffect, useState, useCallback } from 'react'
import { useWallet } from '@/lib/wallet-context'

interface ScanResult {
  block: number; timestamp: string
  pairs: Record<string, { source: string; rate: number }[]>
  opportunities: { type: string; name: string; spreadPct: number; profitable: boolean; pair?: string; legs?: number[]; best?: any; worst?: any }[]
  alerts: { type: string; name: string; spreadPct: number; profitable: boolean; pair?: string }[]
}

const FX_EXPECTED: Record<string, number> = {
  KESm: 0.00768, NGNm: 0.00065, GHSm: 0.0685, ZARm: 0.0535,
  PHPm: 0.0173, XOFm: 0.00168, BRLm: 0.194, EURm: 1.15, GBPm: 1.35,
}

const USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C'

function spreadClass(pct: number): string {
  if (pct > 0.1) return 'high'
  if (pct > 0.01) return 'medium'
  return 'low'
}

function formatSpread(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(4)}%`
}

declare global {
  interface Window { ethereum?: any }
}

export default function SignalsPage() {
  const { wallet, connect, disconnect } = useWallet()

  const [data, setData] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTicker, setActiveTicker] = useState<string | null>(null)

  const [walletBal, setWalletBal] = useState<string>('')
  const [threshold] = useState('0.05')
  const [executing, setExecuting] = useState<string | null>(null)

  const tickerSymbols = ['KESm/USDm', 'XOFm/USDm', 'BRLm/USDm', 'EURm/USDm', 'USDC/USDm', 'USDT/USDm', 'GBPm/USDm', 'NGNm/USDm', 'GHSm/USDm', 'ZARm/USDm']

  const connectWallet = useCallback(async () => {
    await connect()
    if (window.ethereum && wallet) {
      try {
        const bal = await window.ethereum.request({
          method: 'eth_call',
          params: [{ to: USDC, data: '0x70a08231' + wallet.slice(2).padStart(64, '0') }, 'latest']
        })
        setWalletBal((parseInt(bal, 16) / 1e6).toFixed(2))
      } catch {}
    }
  }, [connect, wallet])

  const disconnectWallet = useCallback(() => {
    disconnect()
    setWalletBal('')
  }, [disconnect])

  const fetchData = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const res = await fetch('/api/scan')
      if (!res.ok) throw new Error(await res.text())
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      setData(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  const executeTrade = useCallback(async (opp: any) => {
    if (!wallet) { alert('Connect wallet first'); return }
    setExecuting(opp.name)
    try {
      alert(`Manual execution: ${opp.name} at ${opp.spreadPct}% spread\n\nFund the ArbRouter contract with USDC first.`)
    } catch (e: any) { setError(e.message) }
    setExecuting(null)
  }, [wallet])

  return (
    <div className="app-container">
      {/* Wallet bar */}
      <div className="signals-header">
        <div className="app-meta">
          {data && <span>#{data.block.toLocaleString()} · {Object.keys(data.pairs).length}p</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          {wallet ? (
            <>
              <span className="app-meta" style={{ fontSize: 10 }}>
                {wallet.slice(0,6)}...{wallet.slice(-4)}
                <span style={{ color: 'var(--color-celo-blue)' }}> | {walletBal} USDC</span>
              </span>
              <button className="btn-refresh" onClick={disconnectWallet}>EXIT</button>
            </>
          ) : (
            <button className="btn-refresh" onClick={connectWallet}>CONNECT WALLET</button>
          )}
          <button className="btn-refresh" onClick={fetchData} disabled={loading}>
            {loading ? '…' : '⟳'}
          </button>
        </div>
      </div>

      {/* Ticker */}
      {data && (
        <div className="ticker-wrapper" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="ticker-bar">
            {[...tickerSymbols, ...tickerSymbols].map((sym, idx) => {
              const rates = data.pairs[sym]
              if (!rates || rates.length === 0) return null
              const best = rates.reduce((a, b) => a.rate > b.rate ? a : b)
              const [base] = sym.split('/')
              const expected = FX_EXPECTED[base]
              const dev = expected ? ((best.rate / expected) - 1) * 100 : null
              const devClass = dev && Math.abs(dev) > 0.1 ? (dev > 0 ? 'gain' : 'loss') : ''
              return (
                <div key={`${sym}-${idx}`}
                     className={`ticker-item ${activeTicker === sym ? 'active' : ''}`}
                     onClick={() => setActiveTicker(activeTicker === sym ? null : sym)}>
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
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="panel" style={{ borderColor: 'var(--color-loss)', marginBottom: 'var(--sp-4)' }}>
          <div style={{ padding: 'var(--sp-3)', color: 'var(--color-loss)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
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
          {data.alerts.filter(a => a.spreadPct >= parseFloat(threshold)).length > 0 && (
            <div className="alert-banner">
              <span style={{ fontWeight: 600 }}>
                {data.alerts.filter(a => a.spreadPct >= parseFloat(threshold)).length} SIGNALS ≥{threshold}%
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>
                {data.alerts.filter(a => a.spreadPct >= parseFloat(threshold)).map(a =>
                  a.type === 'triangular' ? a.name : a.pair || a.name).join(' · ')}
              </span>
            </div>
          )}

          {/* Split Panels */}
          <div className="split-panels">
            <div className="panel" style={{ border: 'none' }}>
              <div className="panel-header">
                <span>Opportunities</span>
                <span className="data-value neutral" style={{ fontSize: 11 }}>
                  {data.opportunities.filter(o => o.spreadPct > 0).length} active
                </span>
              </div>
              <div className="opp-scroll">
                <table className="opp-table">
                  <thead>
                    <tr>
                      <th className="col-type"></th>
                      <th className="col-name">Route</th>
                      <th className="col-spread">Spread</th>
                      <th className="col-status" style={{ width: 80 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.opportunities.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: 'var(--sp-6) var(--sp-3)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
                        No arbitrage windows detected</td></tr>
                    )}
                    {data.opportunities.map((o, i) => {
                      const aboveThreshold = o.spreadPct >= parseFloat(threshold)
                      return (
                        <tr key={i}>
                          <td className="col-type">
                            <span className={`type-icon ${o.type === 'triangular' ? 'tri' : 'venue'}`}>
                              {o.type === 'triangular' ? '△' : '○'}
                            </span>
                          </td>
                          <td className="col-name">
                            <span className="name-text">{o.type === 'triangular' ? o.name : (o.pair || o.name)}</span>
                          </td>
                          <td className="col-spread">
                            <span className={`spread-badge ${spreadClass(o.spreadPct)}`}>
                              {formatSpread(o.spreadPct)}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center', padding: 'var(--sp-1) var(--sp-2)' }}>
                            {wallet && aboveThreshold && (
                              <button onClick={() => executeTrade(o)} disabled={executing === o.name}
                                      className="btn-refresh" style={{
                                padding: '2px 8px', fontSize: 10, borderColor: 'var(--color-celo-green)', color: 'var(--color-celo-green)'
                              }}>
                                {executing === o.name ? '…' : '▶ EXEC'}
                              </button>
                            )}
                            {wallet && !aboveThreshold && (
                              <span className="data-value neutral" style={{ fontSize: 9 }}>WAIT</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel" style={{ border: 'none', borderLeft: '1px solid var(--border-default)' }}>
              <div className="panel-header">
                <span>Rates</span>
                <span className="data-value neutral" style={{ fontSize: 11 }}>{Object.keys(data.pairs).length} pairs</span>
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
                          <span className={`data-value ${Math.abs(dev) > 0.1 ? (dev > 0 ? 'gain' : 'loss') : 'neutral'}`}
                                style={{ fontSize: 11, minWidth: 48, textAlign: 'right' }}>
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
              <span>ℤ{threshold}%</span>
            </div>
            <div>{data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '—'}</div>
          </div>
        </>
      )}
    </div>
  )
}
