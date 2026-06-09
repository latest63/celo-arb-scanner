import Link from 'next/link'

export default function Home() {
  return (
    <main className="app-container landing">
      <div className="landing-hero">
        <div className="landing-icon">◈</div>
        <h1 className="landing-title">Celo Arb Terminal</h1>
        <p className="landing-subtitle">
          Real-time cross-stable arbitrage scanner &amp; autonomous trading agent for Celo
        </p>
        <div className="landing-actions">
          <Link href="/signals" className="landing-btn primary">View Signals</Link>
          <Link href="/agent" className="landing-btn secondary">Configure Agent</Link>
        </div>
      </div>

      <div className="landing-features">
        <div className="landing-card">
          <div className="landing-card-icon">📡</div>
          <h3>Live Scanner</h3>
          <p>Monitor real-time rates across Mento &amp; Celo DEXs. Track triangular and venue arbitrage opportunities.</p>
        </div>
        <div className="landing-card">
          <div className="landing-card-icon">🤖</div>
          <h3>Auto Agent</h3>
          <p>Deploy an autonomous trading agent that executes profitable trades 24/7 on your VPS.</p>
        </div>
        <div className="landing-card">
          <div className="landing-card-icon">⚡</div>
          <h3>Wallet Control</h3>
          <p>Connect your wallet via MetaMask or Valora. Execute trades manually or let the agent run.</p>
        </div>
      </div>

      <div className="landing-footer">
        <p>Powered by Celo • Uniswap V3 • Mento</p>
      </div>
    </main>
  )
}
