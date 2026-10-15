import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Lets the examples import the package by name.
  resolve: { alias: { '@bydtech/drift-check': fileURLToPath(new URL('./src/index.ts', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
