import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `npm run dev` proxies /api to the FastAPI backend (`aae serve`, default 127.0.0.1:8080).
const api = process.env.AAE_API_URL || 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': api } },
})
