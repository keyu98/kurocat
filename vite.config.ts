import path from 'node:path';
import { defineConfig } from 'vite';

const EXCLUDED_WHALE_TEXTURE = '\0facai:unused-whale-texture';

export default defineConfig(({ mode }) => ({
  clearScreen: false,
  plugins: mode === 'facai' ? [{
    name: 'facai-exclude-whale-textures',
    enforce: 'pre',
    resolveId(source) {
      return source.startsWith('./assets/dafeiyu/') ? EXCLUDED_WHALE_TEXTURE : null;
    },
    load(id) {
      return id === EXCLUDED_WHALE_TEXTURE ? 'export default "";' : null;
    },
  }] : [],
  build: {
    // Ensure compatibility with macOS 10.15 Catalina WKWebView (Safari 13-15) and Win7 WebView2 109
    target: ['safari13', 'chrome90'],
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        menu: path.resolve(__dirname, 'menu.html'),
        obs: path.resolve(__dirname, 'obs.html'),
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}));
