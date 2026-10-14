import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: true },
  build: { chunkSizeWarningLimit: 4000 },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
