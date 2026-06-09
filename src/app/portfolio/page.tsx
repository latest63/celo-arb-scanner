'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet } from '@/lib/wallet-context'

const AGENT_API = 'https://api.virtusub.xyz/arb'
const FACTORY_ADDR = '0x_CHANGE_ME_AFTER_DEPLOY' // CeloArbFactory

const TOKENS = [
  { symbol: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
  { symbol: 'USDT', address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
  { symbol: 'USDm', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 },
]

// Factory ABI (createAgent + getUserAgents)
const FACTORY_ABI = [
  { inputs: [], name: 'createAgent', outputs: [{ name: 'agent', type: 'address' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }], name: 'getUserAgents', outputs: [{ name: '', type: 'address[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'implementation', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
]

// ArbRouter ABI (balanceOf, deposit, withdraw)
const ROUTER_ABI = [
  { inputs: [{ name: 'token', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'deposit', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'to', type: 'address' }], name: 'withdraw', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'owner', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
]

declare global {
  interface Window { ethereum?: any }
}

export default function PortfolioPage() {
  const router = useRouter()
  const { wallet, connect, disconnect, switchToCelo, error: walletErr, clearError } = useWallet()

  const [agents, setAgents] = useState<{ addr: string; balances: Record<string, number> }[]>([])
  const [walletBals, setWalletBals] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [creatingAgent, setCreatingAgent] = useState(false)
  const [depositAgent, setDepositAgent] = useState('')
  const [depositToken, setDepositToken] = useState('USDC')
  const [depositAmount, setDepositAmount] = useState('')
  const [txPending, setTxPending] = useState(false)

  // ── Fetch user's agents + balances ──
  const refresh = useCallback(async () => {
    if (!wallet || !window.ethereum) return
    setLoading(true)
    try {
      // Get user's agents from factory
      const agentsData = await window.ethereum.request({
        method: 'eth_call',
        params: [{
          to: FACTORY_ADDR,
          data: '0x2d2866d4' + wallet.slice(2).padStart(64, '0'), // getUserAgents(address)
        }, 'latest'],
      })

      // Parse the result (dynamic array)
      const agentAddrs = decodeAddressArray(agentsData)

      // Fetch wallet balances
      const wBals: Record<string, number> = {}
      for (const token of TOKENS) {
        const data = await window.ethereum.request({
          method: 'eth_call',
          params: [{ to: token.address, data: '0x70a08231' + wallet.slice(2).padStart(64, '0') }, 'latest'],
        })
        wBals[token.symbol] = parseInt(data, 16) / 10 ** token.decimals
      }
      setWalletBals(wBals)

      // Fetch each agent's balance
      const agentList = []
      for (const addr of agentAddrs) {
        const bals: Record<string, number> = {}
        for (const token of TOKENS) {
          const balData = await window.ethereum.request({
            method: 'eth_call',
            params: [{ to: addr, data: '0x70a08231' + addr.slice(2).padStart(64, '0') }, 'latest'],
          })
          bals[token.symbol] = parseInt(balData, 16) / 10 ** token.decimals
        }
        agentList.push({ addr, balances: bals })
      }
      setAgents(agentList)
      if (agentList.length > 0 && !depositAgent) setDepositAgent(agentList[0].addr)
      setError(null)
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }, [wallet, depositAgent])

  useEffect(() => {
    if (wallet) refresh()
  }, [wallet, refresh])

  // ── Create Agent (calls factory contract) ──
  const createAgent = useCallback(async () => {
    if (!wallet) return
    setCreatingAgent(true); setError(null); setTxHash(null)
    try {
      await switchToCelo()
      const tx = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: wallet, to: FACTORY_ADDR, data: '0xcf5e2cb4' }], // createAgent()
      })
      setTxHash(tx)
      // Wait for tx then refresh
      setTimeout(refresh, 8000)
    } catch (e: any) { setError(e.message || 'Transaction rejected') }
    setCreatingAgent(false)
  }, [wallet, switchToCelo, refresh])

  // ── Deposit to selected agent ──
  const deposit = useCallback(async () => {
    if (!wallet || !depositAgent || !depositAmount) return
    setTxPending(true); setError(null); setTxHash(null)
    try {
      await switchToCelo()
      const token = TOKENS.find(t => t.symbol === depositToken)!
      const amountWei = '0x' + BigInt(Math.floor(parseFloat(depositAmount) * 10 ** token.decimals)).toString(16)

      // First approve the agent to spend our tokens
      const approveData = '0x095ea7b3' + depositAgent.slice(2).padStart(64, '0') + amountWei.slice(2).padStart(64, '0')
      await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: wallet, to: token.address, data: approveData }],
      })

      // Then deposit
      const depositData = '0x47e7ef24' + token.address.slice(2).padStart(64, '0') + amountWei.slice(2).padStart(64, '0')
      const tx = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: wallet, to: depositAgent, data: depositData }],
      })
      setTxHash(tx)
      setTimeout(refresh, 8000)
    } catch (e: any) { setError(e.message || 'Transaction rejected') }
    setTxPending(false)
  }, [wallet, depositAgent, depositToken, depositAmount, switchToCelo, refresh])

  const displayErr = error || walletErr

  return (
    <div className="app-container">
      <div className="signals-header">
        <div>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Portfolio</h2>
          <span className="data-value neutral" style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>
            {agents.length} agent{agents.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          {wallet ? (
            <>
              <span className="app-meta" style={{ fontSize: 10 }}>{wallet.slice(0,6)}...{wallet.slice(-4)}</span>
              <button className="btn-refresh" onClick={disconnect}>EXIT</button>
            </>
          ) : (
            <button className="btn-refresh" onClick={connect}>CONNECT WALLET</button>
          )}
        </div>
      </div>

      {displayErr && (
        <div className="panel" style={{ borderColor: 'var(--color-loss)', marginBottom: 'var(--sp-4)' }}>
          <div style={{ padding: 'var(--sp-3)', color: 'var(--color-loss)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            {displayErr}
          </div>
        </div>
      )}

      {txHash && (
        <div className="panel" style={{ borderColor: 'var(--color-celo-blue)', marginBottom: 'var(--sp-4)' }}>
          <div style={{ padding: 'var(--sp-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            ✅ TX sent:{' '}
            <a href={`https://celoscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-celo-blue)' }}>
              {txHash.slice(0,20)}...
            </a>
          </div>
        </div>
      )}

      {!wallet && (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
            Connect your wallet to create agents and deposit funds
          </p>
        </div>
      )}

      {wallet && (
        <>
          {/* Create Agent */}
          <div className="panel" style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="panel-header">
              <span>🤖 Agents</span>
              <button className="btn-refresh" onClick={refresh} disabled={loading}>
                {loading ? '…' : '⟳'}
              </button>
            </div>
            {agents.length === 0 && !loading && (
              <div style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
                No agents yet. Create one to start trading.
              </div>
            )}
            {agents.length > 0 && (
              <div className="agent-list">
                {agents.map((ag, i) => (
                  <div key={ag.addr} className="agent-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <div>
                        <span className="data-value" style={{ fontSize: 12, fontWeight: 600 }}>Agent #{i + 1}</span>
                        <span className="data-value neutral" style={{ fontSize: 10, marginLeft: 'var(--sp-2)', fontFamily: 'var(--font-mono)' }}>
                          {ag.addr.slice(0,8)}...{ag.addr.slice(-4)}
                        </span>
                      </div>
                      <span className="data-value gain" style={{ fontSize: 12 }}>
                        ${(ag.balances.USDC + ag.balances.USDT).toFixed(2)}
                      </span>
                    </div>
                    <div className="data-row" style={{ border: 'none', padding: 'var(--sp-1) 0' }}>
                      {TOKENS.filter(t => ag.balances[t.symbol] > 0).map(t => (
                        <span key={t.symbol} className="data-value neutral" style={{ fontSize: 10, marginRight: 'var(--sp-3)' }}>
                          {ag.balances[t.symbol].toFixed(t.decimals === 6 ? 2 : 4)} {t.symbol}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ padding: 'var(--sp-3)', borderTop: agents.length > 0 ? '1px solid var(--border-default)' : 'none' }}>
              <button className="btn-refresh" onClick={createAgent} disabled={creatingAgent}
                      style={{ borderColor: 'var(--color-celo-blue)', color: 'var(--color-celo-blue)', padding: '6px 20px', fontSize: 12, fontWeight: 600 }}>
                {creatingAgent ? '⏳ CREATING...' : '➕ CREATE NEW AGENT'}
              </button>
              <span className="data-value neutral" style={{ fontSize: 10, marginLeft: 'var(--sp-3)' }}>
                Creates a personal contract on-chain (gas cost applies)
              </span>
            </div>
          </div>

          {/* Deposit */}
          {agents.length > 0 && (
            <div className="panel" style={{ marginBottom: 'var(--sp-4)' }}>
              <div className="panel-header">
                <span>💰 Deposit to Agent</span>
              </div>
              <div style={{ padding: 'var(--sp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                  <span className="data-label">Agent:</span>
                  <select value={depositAgent} onChange={e => setDepositAgent(e.target.value)}
                          className="agent-input" style={{ width: 200, cursor: 'pointer' }}>
                    {agents.map((ag, i) => (
                      <option key={ag.addr} value={ag.addr}>Agent #{i + 1} ({ag.addr.slice(0,8)}...)</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                  <select value={depositToken} onChange={e => setDepositToken(e.target.value)}
                          className="agent-input" style={{ width: 90, cursor: 'pointer' }}>
                    {TOKENS.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
                  </select>
                  <input type="number" step="0.01" min="0" value={depositAmount}
                         onChange={e => setDepositAmount(e.target.value)}
                         placeholder="Amount" className="agent-input" style={{ width: 120 }} />
                  {walletBals[depositToken] !== undefined && (
                    <span className="data-value neutral" style={{ fontSize: 10 }}>
                      Wallet: {walletBals[depositToken].toFixed(2)}
                    </span>
                  )}
                  <button className="btn-refresh" onClick={deposit} disabled={txPending || !depositAmount}
                          style={{ borderColor: 'var(--color-celo-green)', color: 'var(--color-celo-green)' }}>
                    {txPending ? '⏳ DEPOSITING...' : 'DEPOSIT'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Quick link to agent page */}
          {agents.length > 0 && (
            <div className="panel">
              <div className="panel-header">🚀 Ready to trade?</div>
              <div style={{ padding: 'var(--sp-3)' }}>
                <button className="btn-refresh" onClick={() => router.push('/agent')}
                        style={{ borderColor: 'var(--color-celo-blue)', color: 'var(--color-celo-blue)', padding: '6px 20px', fontSize: 12, fontWeight: 600 }}>
                  ▶ CONFIGURE & RUN AGENT
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Helper: decode Solidity dynamic address array from eth_call ──
function decodeAddressArray(hex: string): string[] {
  if (!hex || hex === '0x') return []
  const data = hex.startsWith('0x') ? hex.slice(2) : hex
  // offset(32) + length(32) + addresses
  const lenBytes = data.slice(64, 128)
  const count = parseInt(lenBytes, 16)
  const addrs: string[] = []
  for (let i = 0; i < count; i++) {
    const start = 128 + i * 64
    const raw = data.slice(start, start + 64)
    addrs.push('0x' + raw.slice(24)) // last 20 bytes
  }
  return addrs
}
