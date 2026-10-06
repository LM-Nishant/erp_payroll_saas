import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Bundle workspace packages (they ship TypeScript sources); keep npm deps external.
  noExternal: [/^@erp\//],
});
