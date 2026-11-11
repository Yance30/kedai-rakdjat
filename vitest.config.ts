import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', maxWorkers: 1, testTimeout: 30_000, hookTimeout: 60_000 } });
