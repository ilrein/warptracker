import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'

const sha = execSync('git rev-parse --short HEAD').toString().trim()
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(`${sha} · ${stamp}`),
  },
})
