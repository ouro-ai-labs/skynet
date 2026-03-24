import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 15000,
    include: ['src/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // @pinixai/weixin-bot ships without a dist/ directory, so Vite cannot
      // resolve its exports field.  Point to the TypeScript source so that
      // vitest can process it (and so that vi.mock can intercept it).
      '@pinixai/weixin-bot': path.resolve(
        __dirname,
        'node_modules/@pinixai/weixin-bot/src/index.ts',
      ),
    },
  },
});
