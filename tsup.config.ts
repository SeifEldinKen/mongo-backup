import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  bundle: true,
  minify: true,
  keepNames: true,
  skipNodeModulesBundle: true,
  shims: true,
});
