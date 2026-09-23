/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/* Bundled examples: `import b64 from '../fixtures/x.stheme'` yields the package as base64. */
function stheme(): Plugin {
  return {
    name: 'stheme',
    load(id) {
      if (id.endsWith('.stheme')) return 'export default ' + JSON.stringify(readFileSync(id).toString('base64'));
    },
  };
}

/* The single-file build embeds the bitmap font, so it carries the font's license notice. */
function fontLicense(): Plugin {
  const notice = readFileSync(new URL('./src/core/FONT-LICENSE.txt', import.meta.url), 'utf8');
  return {
    name: 'font-license',
    apply: 'build',
    transformIndexHtml: html => html.replace('<!doctype html>', '<!doctype html>\n<!-- Bitmap font license:\n' + notice + '\n-->'),
  };
}

export default defineConfig({
  plugins: [react(), stheme(), fontLicense(), viteSingleFile()],
  // serve.py relays the TV API; run it next to `npm run dev` to try "Send to TV".
  server: { proxy: { '/__device': 'http://127.0.0.1:4173' } },
  test: { include: ['test/**/*.test.ts'] },
});
