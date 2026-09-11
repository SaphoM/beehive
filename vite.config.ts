import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { getAppVersion, getAppSha } from './scripts/appVersion.mjs'

// Git-derived version (see scripts/appVersion.mjs) injected into the web build
// exactly like the other build-time values this app already reads off
// import.meta.env (VITE_LIVEKIT_URL, VITE_DESKTOP_DOWNLOAD_*). Shown in the
// footer so the live/deployed build is always identifiable at a glance.
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(getAppVersion()),
    'import.meta.env.VITE_APP_SHA': JSON.stringify(getAppSha()),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
