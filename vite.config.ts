/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base: './' 讓網站在 GitHub Pages 的任何 repository 名稱底下都能正確載入
export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    environment: 'node',
  },
})
