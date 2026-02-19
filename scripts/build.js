import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/index.js',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    // All npm dependencies stay external — resolved from node_modules at runtime
    'commander',
    'ink',
    'react',
    '@inkjs/ui',
    'zod',
    'conf',
    'ai',
    '@ai-sdk/anthropic',
    '@ai-sdk/openai',
    // Node.js built-ins
    'node:*',
    'fs',
    'path',
    'child_process',
    'module',
    'url',
    'crypto',
    'os',
    'util',
    'stream',
    'events',
  ],
  loader: { '.tsx': 'tsx' },
  target: 'node20',
  // Log build result
  logLevel: 'info',
});
