// Every option, in a .mjs config. Paths are relative to this file's folder.
import { defineConfig } from '@bydtech/drift-check';

export default defineConfig({
  groups: [
    {
      // The source of truth: --fix copies it over the others.
      name: 'content',
      source: 'packages/content/services.json',
      files: ['apps/*/src/content/services.json'],
      // Parsed and compared canonically: key order and formatting do not matter.
      mode: 'json',
    },
    {
      // No source: the members must agree with each other. --fix leaves it alone.
      name: 'license',
      files: ['LICENSE', 'packages/*/LICENSE'],
      // Line endings and trailing whitespace do not matter.
      mode: 'text',
    },
    {
      // Byte for byte (the default mode). A copy that may not exist yet is allowed.
      name: 'logo',
      source: 'brand/logo.svg',
      files: ['apps/web/public/logo.svg', { path: 'apps/docs/public/logo.svg', optional: true }],
    },
  ],
});
