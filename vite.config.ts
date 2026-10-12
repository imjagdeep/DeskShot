import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { cpSync, mkdirSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;

/**
 * OCR runs offline: tesseract's worker, its engine (the LSTM builds; the
 * worker picks relaxed-SIMD, SIMD or plain to suit the computer) and the
 * English model ("best_int": accurate and small) go to public/tesseract/.
 * Same as DeskFolio.
 */
function tesseractAssets(): Plugin {
  return {
    name: "tesseract-assets",
    buildStart() {
      const to = "public/tesseract";
      mkdirSync(`${to}/core`, { recursive: true });
      mkdirSync(`${to}/lang`, { recursive: true });
      cpSync("node_modules/tesseract.js/dist/worker.min.js", `${to}/worker.min.js`);
      for (const v of ["", "simd-", "relaxedsimd-"]) {
        cpSync(`node_modules/tesseract.js-core/tesseract-core-${v}lstm.wasm.js`, `${to}/core/tesseract-core-${v}lstm.wasm.js`);
      }
      cpSync("node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", `${to}/lang/eng.traineddata.gz`);
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tesseractAssets()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
