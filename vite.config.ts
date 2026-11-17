/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tauri usa un puerto fijo y no debe limpiar la consola (ahí salen los errores de Rust).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], css: false },
})
