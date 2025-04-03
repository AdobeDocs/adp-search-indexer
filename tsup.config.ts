import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/verify.ts'],
  format: 'esm', // Output format
  sourcemap: true,
  clean: true,
  dts: true, // Generate declaration files
  outDir: 'dist',
  env: {
    NODE_ENV: process.env.NODE_ENV || 'production',
  },
  noExternal: [/.*/], // Bundle everything
  treeshake: true,
  platform: 'node', // Specify node platform explicitly
});
