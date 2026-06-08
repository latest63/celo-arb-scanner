/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        celo: '#35D07F',
        'celo-dark': '#1a1a2e',
      },
    },
  },
  plugins: [],
}
