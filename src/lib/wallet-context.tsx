'use client'

import { createContext, useContext, useState, useCallback, useEffect } from 'react'

interface WalletContextType {
  wallet: string | null
  connect: () => Promise<void>
  disconnect: () => void
  switchToCelo: () => Promise<void>
  error: string | null
  clearError: () => void
}

const WalletContext = createContext<WalletContextType>({
  wallet: null,
  connect: async () => {},
  disconnect: () => {},
  switchToCelo: async () => {},
  error: null,
  clearError: () => {},
})

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Restore from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('celo-arb-wallet')
    if (saved) setWallet(saved)
  }, [])

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('Install MetaMask or Valora browser')
      return
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      setWallet(accounts[0])
      localStorage.setItem('celo-arb-wallet', accounts[0])
      setError(null)
      // Auto-switch to Celo
      const chainId = await window.ethereum.request({ method: 'eth_chainId' })
      if (chainId !== '0xa4ec') {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xa4ec' }],
        }).catch((e: any) => {
          if (e.code === 4902) {
            return window.ethereum.request({
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
        })
      }
    } catch (e: any) {
      setError(e.message || 'Connection failed')
    }
  }, [])

  const disconnect = useCallback(() => {
    setWallet(null)
    localStorage.removeItem('celo-arb-wallet')
    setError(null)
  }, [])

  const switchToCelo = useCallback(async () => {
    if (!window.ethereum) return
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xa4ec' }],
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

  const clearError = useCallback(() => setError(null), [])

  return (
    <WalletContext.Provider value={{ wallet, connect, disconnect, switchToCelo, error, clearError }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  return useContext(WalletContext)
}
