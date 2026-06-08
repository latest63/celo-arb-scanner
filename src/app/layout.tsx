import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Celo Arb Scanner',
  description: 'Real-time cross-stable arbitrage scanner for Celo',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
