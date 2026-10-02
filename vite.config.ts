import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'

const config: UserConfig = {
  plugins: [react()],
  // vitest 通过 vite 配置读取 test 字段，类型由 vitest/config 扩展
  ...({
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  }),
}

export default defineConfig(config)
