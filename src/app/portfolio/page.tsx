'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const AGENT_API = 'https://api.virtusub.xyz/arb'

const TOKENS = [
  { symbol: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
  { symbol: 'USDT', address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', decimals: 6 },
  { symbol: 'USDm', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 },
  { symbol: 'EURm', address: '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73', decimals: 18 },
  { symbol: 'KESm', address: '0x456a3D042C0DbD3db53D5489e98dFb038553B0d0', decimals: 18 },
  { symbol: 'NGNm', address: '0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71', decimals: 18 },
]

// ERC20 transfer ABI
const ERC20_ABI = [
  { constant: false, inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], type: 'function' },
  { constant: true, inputs: [{ name: 'owner', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], type: 'function' },
  { constant: true, inputs: [], name: 'decimals', outputs: [{ name: '', type: 'uint8' }], type: 'function' },
]

declare global {
  interface Window { ethereum?: any }
}

export default function PortfolioPage() {
  const router = useRouter()

  const [wallet, setWallet] = useState<string | null>(null)
  const [balances, setBalances] = useState<Record<string, { wallet: number; contract: number }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [depositToken, setDepositToken] = useState('USDC')
  const [depositAmount, setDepositAmount] = useState('')
  const [txPending, setTxPending] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [agentName, setAgentName] = useState('')
  const [creatingAgent, setCreatingAgent] = useState(false)

  const CONTRACT_ADDR = '0xD0320A23b7D0E0Ea5D351b0Ead308462791b063b' // ArbRouter on Celo

  const fetchBalances = useCallback(async () => {
    if (!wallet || !window.ethereum) return
    setLoading(true)
    try {
      const newBals: Record<string, { wallet: number; contract: number }> = {}
      for (const token of TOKENS) {
        // Wallet balance
        const balData = await window.ethereum.request({
          method: 'eth_call',
          params: [{
            to: token.address,
            data: '0x70a08231' + wallet.slice(2).padStart(64, '0')
          }, 'latest']
        })
        const walletBal = parseInt(balData, 16) / 10 ** token.decimals

        // Contract balance
        const contractBalData = await window.ethereum.request({
          method: 'eth_call',
          params: [{
            to: token.address,
            data: '0x70a08231' + CONTRACT_ADDR.slice(2).padStart(64, '0')
          }, 'latest']
        })
        const contractBal = parseInt(contractBalData, 16) / 10 ** token.decimals

        newBals[token.symbol] = { wallet: walletBal, contract: contractBal }
      }
      setBalances(newBals)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }, [wallet])

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) { alert('Install MetaMask or Valora browser'); return }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      setWallet(accounts[0])
    } catch (e: any) { setError(e.message) }
  }, [])

  const disconnect = useCallback(() => { setWallet(null); setBalances({}) }, [])

  useEffect(() => {
    if (wallet) fetchBalances()
  }, [wallet, fetchBalances])

  // Switch chain to Celo
  const switchToCelo = useCallback(async () => {
    if (!window.ethereum) return
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xa4ec' }], // Celo mainnet
      })
    } catch (e: any) {
      if (e.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0xa4ec',
            chainName: 'Celo Mainnet',
            nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
            rpcUrls: ['https://forno.celo.org'],
            blockExplorerUrls: ['https://celoscan.io'],
          }],
        })
      }
    }
  }, [])

  // Deposit: transfer tokens from wallet to contract
  const deposit = useCallback(async () => {
    if (!wallet || !depositAmount || parseFloat(depositAmount) <= 0) return
    setTxPending(true); setTxHash(null); setError(null)
    try {
      await switchToCelo()
      const token = TOKENS.find(t => t.symbol === depositToken)!
      const amountWei = BigInt(Math.floor(parseFloat(depositAmount) * 10 ** token.decimals))
      const transferData = '0xa9059cbb' + CONTRACT_ADDR.slice(2).padStart(64, '0') + amountWei.toString(16).padStart(64, '0')

      const tx = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: wallet,
          to: token.address,
          data: transferData,
        }],
      })
      setTxHash(tx)
      // Wait a bit then refresh
      setTimeout(fetchBalances, 5000)
    } catch (e: any) {
      setError(e.message || 'Transaction rejected')
    }
    setTxPending(false)
  }, [wallet, depositAmount, depositToken, switchToCelo, fetchBalances])

  // Create agent — saves config to VPS API + navigates to /agent
  const createAgent = useCallback(async () => {
    const name = agentName.trim() || 'My Agent'
    setCreatingAgent(true)
    setError(null)
    try {
      // Save the agent config to VPS
      const res = await fetch(`${AGENT_API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: false,
          min_spread: 0.05,
          slippage: 0.3,
          interval: 30,
          max_trade_size: 100,
          trade_fraction: 0.5,
        }),
      })
      const result = await res.json()
      if (!result.ok) throw new Error(result.error || 'API error')
      router.push('/agent')
    } catch (e: any) {
      setError(e.message)
    }
    setCreatingAgent(false)
  }, [agentName, router])

  const selectedToken = TOKENS.find(t => t.symbol === depositToken)
  const contractBalancesTotal = Object.values(balances).reduce((sum, b) => sum + b.contract, 0)

  return (
    <div className="app-container">
      {/* Header */}
      <div className="signals-header">
        <div>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Portfolio</h2>
          {contractBalancesTotal > 0 && (
            <span className="data-value gain" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              ${contractBalancesTotal.toFixed(2)} in contract
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          {wallet ? (
            <>
              <span className="app-meta" style={{ fontSize: 10 }}>
                {wallet.slice(0,6)}...{wallet.slice(-4)}
              </span>
              <button className="btn-refresh" onClick={disconnect}>EXIT</button>
            </>
          ) : (
            <button className="btn-refresh" onClick={connectWallet}>CONNECT WALLET</button>
          )}
        </div>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: 'var(--color-loss)', marginBottom: 'var(--sp-4)' }}>
          <div style={{ padding: 'var(--sp-3)', color: 'var(--color-loss)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            {error}
          </div>
        </div>
      )}

      {txHash && (
        <div className="panel" style={{ borderColor: 'var(--color-celo-blue)', marginBottom: 'var(--sp-4)' }}>
          <div style={{ padding: 'var(--sp-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            ✅ Transaction sent:{' '}
            <a href={`https://celoscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
               style={{ color: 'var(--color-celo-blue)' }}>
              {txHash.slice(0, 20)}...
            </a>
          </div>
        </div>
      )}

      {!wallet && (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
            Connect your wallet to view portfolio and fund the trading contract
          </p>
        </div>
      )}

      {wallet && (
        <>
          {/* Balances */}
          <div className="panel" style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="panel-header">
              <span>Balances</span>
              <button className="btn-refresh" onClick={fetchBalances} disabled={loading}>
                {loading ? '…' : '⟳'}
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="portfolio-table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th style={{ textAlign: 'right' }}>Wallet</th>
                    <th style={{ textAlign: 'right' }}>Contract</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {TOKENS.map(token => {
                    const bal = balances[token.symbol]
                    if (!bal) return null
                    const total = bal.wallet + bal.contract
                    return (
                      <tr key={token.symbol}>
                        <td><span className="ticker-symbol">{token.symbol}</span></td>
                        <td style={{ textAlign: 'right' }}>{bal.wallet.toFixed(token.decimals === 6 ? 2 : 4)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={bal.contract > 0 ? 'data-value gain' : 'data-value neutral'}>
                            {bal.contract.toFixed(token.decimals === 6 ? 2 : 4)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>{total.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!loading && Object.keys(balances).length > 0 && (
              <div style={{ padding: 'var(--sp-2) var(--sp-3)', fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                Contract: <span style={{ color: 'var(--text-secondary)' }}>{CONTRACT_ADDR.slice(0, 10)}...{CONTRACT_ADDR.slice(-6)}</span>
              </div>
            )}
          </div>

          {/* Deposit */}
          <div className="panel" style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="panel-header">
              <span>Deposit to Contract</span>
            </div>
            <div style={{ padding: 'var(--sp-3)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <select value={depositToken}
                      onChange={e => setDepositToken(e.target.value)}
                      className="agent-input" style={{ width: 90, cursor: 'pointer' }}>
                {TOKENS.map(t => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
              </select>
              <input type="number" step="0.01" min="0" value={depositAmount}
                     onChange={e => setDepositAmount(e.target.value)}
                     placeholder="Amount"
                     className="agent-input" style={{ width: 120 }} />
              {selectedToken && balances[selectedToken.symbol] && (
                <span className="data-value neutral" style={{ fontSize: 10 }}>
                  Balance: {balances[selectedToken.symbol].wallet.toFixed(2)}
                </span>
              )}
              <button className="btn-refresh" onClick={deposit} disabled={txPending || !depositAmount}
                      style={{ borderColor: 'var(--color-celo-green)', color: 'var(--color-celo-green)' }}>
                {txPending ? 'SENDING...' : 'DEPOSIT'}
              </button>
            </div>
          </div>

          {/* Create Agent */}
          <div className="panel">
            <div className="panel-header">🤖 Create Agent</div>
            <div style={{ padding: 'var(--sp-3)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <input type="text" value={agentName}
                     onChange={e => setAgentName(e.target.value)}
                     placeholder="Agent name (optional)"
                     className="agent-input" style={{ width: 200 }} />
              <button className="btn-refresh" onClick={createAgent} disabled={creatingAgent}
                      style={{ borderColor: 'var(--color-celo-blue)', color: 'var(--color-celo-blue)', padding: '4px 16px', fontSize: 12, fontWeight: 600 }}>
                {creatingAgent ? 'CREATING...' : '▶ CREATE & CONFIGURE'}
              </button>
            </div>
            <div style={{ padding: '0 var(--sp-3) var(--sp-3)', fontSize: 10, color: 'var(--text-tertiary)' }}>
              Creates an agent linked to this contract. You&apos;ll configure spread and amount on the Agent page.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
