import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DEV__: 'true',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/core/**/*.ts',
        'src/config/**/*.ts',
        'src/engine/**/*.ts',
        'src/input/**/*.ts',
        'src/entities/**/*.ts',
        'src/sim/**/*.ts',
        'src/upgrades/**/*.ts',
        'src/save/**/*.ts',
        'src/states/**/*.ts',
      ],
      thresholds: {
        lines: 85,
        branches: 80,
      },
    },
  },
});
