import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
});
