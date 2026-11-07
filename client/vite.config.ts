import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Sends API calls to the Express server, so the browser sees one origin and needs no CORS.
    proxy: { '/api': 'http://localhost:3000' },
  },
})
