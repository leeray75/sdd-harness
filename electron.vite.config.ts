import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// The production policy lives in src/renderer/index.html. Dev only relaxes it
// for what the Vite dev server and React Fast Refresh need.
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'none'";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          agent: resolve(__dirname, 'src/agent/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [
      react(),
      {
        name: 'harness-csp',
        transformIndexHtml: {
          order: 'pre',
          handler(html: string, ctx: { server?: unknown }) {
            if (!ctx.server) {
              return html;
            }
            // Fail loudly if the page's CSP drifts from PROD_CSP, rather than
            // silently serving the strict policy to the dev server.
            if (!html.includes(PROD_CSP)) {
              throw new Error(
                'src/renderer/index.html CSP does not match PROD_CSP in electron.vite.config.ts; update both',
              );
            }
            return html.replace(PROD_CSP, DEV_CSP);
          },
        },
      },
    ],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
