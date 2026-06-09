import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import Link from 'next/link'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Celo Arb Terminal',
  description: 'Real-time cross-stable arbitrage scanner for Celo',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body style={{ fontFamily: 'var(--font-sans, Inter, -apple-system, sans-serif)' }}>
        <nav className="app-nav">
          <div className="app-nav-brand">
            <Link href="/" className="app-nav-logo">◈</Link>
            <Link href="/" className="app-nav-title">Celo Arb</Link>
          </div>
          <div className="app-nav-links">
            <Link href="/portfolio" className="app-nav-link">Portfolio</Link>
            <Link href="/signals" className="app-nav-link">Signals</Link>
            <Link href="/agent" className="app-nav-link">Agent</Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  )
}
