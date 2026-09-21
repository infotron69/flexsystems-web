import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Baked into the bundle at build time -- shown in the sidebar on every
  // screen so it's obvious whether a browser is looking at a stale cached
  // build vs the one actually just deployed.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8010',
    },
    // Temporary: lets the cloudflared quick-tunnel used for screenshotting
    // reach this dev server. Safe to remove once that's done - trycloudflare
    // subdomains are random per-run anyway.
    allowedHosts: ['.trycloudflare.com'],
  },
})
