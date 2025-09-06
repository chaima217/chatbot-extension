import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      // We build the popup (index.html) and the content script (inject.js)
      input: {
        index: resolve(__dirname, 'index.html'),
        inject: resolve(__dirname, 'src/content/inject.js')
      },
      // predictable output file names (no hashes)
      output: {
        entryFileNames: (chunk) => `${chunk.name}.js`,
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
});