'use client'

import { useEffect, useState, useCallback } from 'react'

const AGENT_API = 'https://api.virtusub.xyz/arb'

interface AgentStatus {
  ok: boolean
  config: {
    enabled: boolean
    min_spread: number
    slippage: number
    interval: number
    max_trade_size: number
    trade_fraction: number
  }
  stats: {
    scans: number
    trades: number
    errors: number
    last_trade: {
      time: string
      opp: string
      spread: number
      tx: string
      block: number
    } | null
    started_at: string
    last_update: string
  }
  service: {
    running: boolean
    since?: string
    status?: string
  }
}

export default function AgentPage() {
  const [agent, setAgent] = useState<AgentStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [agentBusy, setAgentBusy] = useState(false)
  const [threshold, setThreshold] = useState('0.05')
  const [intervalVal, setIntervalVal] = useState('30')
  const [slippage, setSlippage] = useState('0.3')

  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_API}/`)
      if (!res.ok) throw new Error('API unreachable')
      const data: AgentStatus = await res.json()
      setAgent(data)
      if (data.config) {
        setThreshold(String(data.config.min_spread))
        setIntervalVal(String(data.config.interval))
        setSlippage(String(data.config.slippage))
      }
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    fetchAgent()
    const interval = setInterval(fetchAgent, 10000)
    return () => clearInterval(interval)
  }, [fetchAgent])

  const updateConfig = useCallback(async (updates: Record<string, any>) => {
    setAgentBusy(true)
    try {
      const res = await fetch(`${AGENT_API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error || 'API error')
      await fetchAgent()
      setError(null)
    } catch (e: any) {
      setError(e.message)
    }
    setAgentBusy(false)
  }, [fetchAgent])

  const startAgent = useCallback(async () => {
    setAgentBusy(true)
    try {
      await updateConfig({ enabled: true })
      const res = await fetch(`${AGENT_API}/start`, { method: 'POST' })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error || 'Start failed')
      await fetchAgent()
    } catch (e: any) { setError(e.message) }
    setAgentBusy(false)
  }, [updateConfig, fetchAgent])

  const stopAgent = useCallback(async () => {
    setAgentBusy(true)
    try {
      await updateConfig({ enabled: false })
      await fetch(`${AGENT_API}/stop`, { method: 'POST' })
      await fetchAgent()
    } catch (e: any) { setError(e.message) }
    setAgentBusy(false)
  }, [updateConfig, fetchAgent])

  const isAgentRunning = agent?.service?.running && agent?.config?.enabled

  return (
    <div className="app-container">
      {/* Header */}
      <div className="signals-header">
        <div className="app-meta">
          {agent && <span>{agent.stats.scans} scans · {agent.stats.trades} trades</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          {agent && (
            <span className={`data-value ${isAgentRunning ? 'gain' : 'neutral'}`}
                  style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
              {isAgentRunning ? '● RUNNING' : '○ IDLE'}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: 'var(--color-loss)', marginBottom: 'var(--sp-4)' }}>
          <div style={{ padding: 'var(--sp-3)', color: 'var(--color-loss)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            {error}
            {!agent && <span> — <button className="btn-refresh" onClick={fetchAgent} style={{ fontSize: 11 }}>retry</button></span>}
          </div>
        </div>
      )}

      {!agent && !error && (
        <div className="loading-screen">
          <div className="loading-spinner" />
          <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>Connecting to agent API...</span>
        </div>
      )}

      {agent && (
        <>
          {/* Main Control Panel */}
          <div className="panel" style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="panel-header">
              <span>🤖 Agent</span>
              <span className="data-value neutral" style={{ fontSize: 10 }}>
                {agent.service.running ? 'Service active' : 'Service stopped'}
                {agent.service.since && ` · since ${agent.service.since}`}
              </span>
            </div>

            {/* Status */}
            <div className="agent-controls-row" style={{ borderBottom: '1px solid var(--border-default)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <span style={{
                    width: 12, height: 12, borderRadius: '50%',
                    background: isAgentRunning ? 'var(--color-celo-green)' : 'var(--text-tertiary)',
                    display: 'inline-block'
                  }} />
                  <span className={`data-value ${isAgentRunning ? 'gain' : 'neutral'}`}
                        style={{ fontSize: 14, fontWeight: 600 }}>
                    {isAgentRunning ? 'RUNNING' : 'IDLE'}
                  </span>
                </div>
                {isAgentRunning ? (
                  <button className="btn-refresh" onClick={stopAgent} disabled={agentBusy}
                          style={{ borderColor: 'var(--color-loss)', color: 'var(--color-loss)', padding: '6px 24px', fontSize: 13, fontWeight: 600 }}>
                    ■ STOP
                  </button>
                ) : (
                  <button className="btn-refresh" onClick={startAgent} disabled={agentBusy}
                          style={{ borderColor: 'var(--color-celo-blue)', color: 'var(--color-celo-blue)', padding: '6px 24px', fontSize: 13, fontWeight: 600 }}>
                    ▶ START
                  </button>
                )}
              </div>
            </div>

            {/* Settings */}
            <div className="agent-settings-row">
              <div className="agent-setting">
                <span className="data-label">Min Spread</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <input type="number" step="0.01" value={threshold}
                         onChange={e => { setThreshold(e.target.value); updateConfig({ min_spread: parseFloat(e.target.value) || 0 }) }}
                         className="agent-input" />
                  <span className="data-value neutral" style={{ fontSize: 11 }}>%</span>
                </div>
              </div>
              <div className="agent-setting">
                <span className="data-label">Interval</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <input type="number" step="5" value={intervalVal}
                         onChange={e => { setIntervalVal(e.target.value); updateConfig({ interval: parseInt(e.target.value) || 30 }) }}
                         className="agent-input" style={{ width: 70 }} />
                  <span className="data-value neutral" style={{ fontSize: 11 }}>s</span>
                </div>
              </div>
              <div className="agent-setting">
                <span className="data-label">Slippage</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <input type="number" step="0.1" value={slippage}
                         onChange={e => { setSlippage(e.target.value); updateConfig({ slippage: parseFloat(e.target.value) || 0.3 }) }}
                         className="agent-input" style={{ width: 70 }} />
                  <span className="data-value neutral" style={{ fontSize: 11 }}>%</span>
                </div>
              </div>
              <div className="agent-setting">
                <span className="data-label">Max Trade</span>
                <span className="data-value neutral" style={{ fontSize: 11 }}>{agent.config.max_trade_size} USDC</span>
              </div>
            </div>
          </div>

          {/* Stats Panel */}
          <div className="split-panels" style={{ marginBottom: 'var(--sp-6)' }}>
            <div className="panel" style={{ border: 'none' }}>
              <div className="panel-header">📊 Performance</div>
              <div className="agent-stats-grid">
                <div className="agent-stat">
                  <span className="agent-stat-value">{agent.stats.scans}</span>
                  <span className="agent-stat-label">Scans</span>
                </div>
                <div className="agent-stat">
                  <span className="agent-stat-value gain">{agent.stats.trades}</span>
                  <span className="agent-stat-label">Trades</span>
                </div>
                <div className="agent-stat">
                  <span className="agent-stat-value loss">{agent.stats.errors}</span>
                  <span className="agent-stat-label">Errors</span>
                </div>
              </div>
              {agent.stats.started_at && (
                <div style={{ padding: 'var(--sp-2) var(--sp-3)', fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  Started: {new Date(agent.stats.started_at).toLocaleString()}
                </div>
              )}
            </div>

            <div className="panel" style={{ border: 'none', borderLeft: '1px solid var(--border-default)' }}>
              <div className="panel-header">🔄 Last Trade</div>
              {agent.stats.last_trade ? (
                <div style={{ padding: 'var(--sp-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  <div className="data-row" style={{ border: 'none', padding: 'var(--sp-1) 0' }}>
                    <span className="data-label">Route</span>
                    <span className="data-value">{agent.stats.last_trade.opp}</span>
                  </div>
                  <div className="data-row" style={{ border: 'none', padding: 'var(--sp-1) 0' }}>
                    <span className="data-label">Spread</span>
                    <span className="data-value gain">+{agent.stats.last_trade.spread}%</span>
                  </div>
                  <div className="data-row" style={{ border: 'none', padding: 'var(--sp-1) 0' }}>
                    <span className="data-label">Block</span>
                    <span className="data-value">#{agent.stats.last_trade.block}</span>
                  </div>
                  <div className="data-row" style={{ border: 'none', padding: 'var(--sp-1) 0' }}>
                    <span className="data-label">TX</span>
                    <span className="data-value" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
                      {agent.stats.last_trade.tx?.slice(0, 30)}...
                    </span>
                  </div>
                  <div className="data-row" style={{ border: 'none', padding: 'var(--sp-1) 0' }}>
                    <span className="data-label">Time</span>
                    <span className="data-value">{new Date(agent.stats.last_trade.time).toLocaleString()}</span>
                  </div>
                </div>
              ) : (
                <div style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
                  No trades yet
                </div>
              )}
            </div>
          </div>

          {/* Raw Config */}
          <div className="panel">
            <div className="panel-header">⚙️ Current Config</div>
            <pre className="agent-config-display">
              {JSON.stringify(agent.config, null, 2)}
            </pre>
          </div>
        </>
      )}
    </div>
  )
}
