import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { buildWebManifest } from "./src/pwa/manifest.js";

const MANIFEST_FILE = "manifest.webmanifest";

/**
 * Emits (and, in dev, serves) the web app manifest. It lives here instead of in
 * public/ so the installed app's name tracks VITE_APP_NAME.
 */
function webManifestPlugin(appName: string): Plugin {
  const body = () => JSON.stringify(buildWebManifest(appName), null, 2);

  return {
    name: "heater-control:web-manifest",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== `/${MANIFEST_FILE}`) return next();
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(body());
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: MANIFEST_FILE,
        source: body(),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return {
    plugins: [
      react(),
      webManifestPlugin(env.VITE_APP_NAME ?? "Heater Control"),
    ],
    server: {
      port: 5173,
      allowedHosts: ["strongbow.rainbow-inconnu.ts.net"],
    },
    build: {
      sourcemap: true,
    },
  };
});
