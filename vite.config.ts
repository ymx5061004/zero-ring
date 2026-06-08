import { defineConfig, type Plugin } from 'vite';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Dev/build convenience: if the generated spritesheets are missing, run the
// procedural generator before serving/bundling. Manual runs: `npm run gen:assets`.
function generateAssetsPlugin(): Plugin {
  return {
    name: 'zero-ring:generate-assets',
    buildStart() {
      const marker = resolve(process.cwd(), 'public', 'assets', 'generated', 'heroes.png');
      if (existsSync(marker)) return;
      try {
        console.log('[零环] 未发现像素素材，正在生成…');
        execFileSync('node', ['scripts/generate-assets.ts'], { stdio: 'inherit' });
      } catch (err) {
        console.warn('[零环] 素材自动生成失败，请手动运行 `npm run gen:assets`：', err);
      }
    },
  };
}

// Static, dependency-light config. `base: './'` keeps asset URLs relative so the
// build can be dropped onto any static host (or opened from a subdirectory).
// `host: true` lets you open the dev server on a phone over the LAN for testing.
export default defineConfig({
  base: './',
  plugins: [generateAssetsPlugin()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
  },
});
