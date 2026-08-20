/**
 * The web app manifest, built rather than checked in so the installed app is
 * named the same thing as the running app (VITE_APP_NAME). Served by the vite
 * plugin in vite.config.ts — see `webManifestPlugin`.
 */
export function buildWebManifest(appName: string): Record<string, unknown> {
  return {
    id: "/",
    name: appName,
    // Home screens truncate hard, so this is deliberately not VITE_APP_NAME.
    short_name: "Heaters",
    description: "Turn the hangar's engine block heaters on before you fly.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Splash screen while the app boots, then the banner colour once it paints.
    background_color: "#f1f5f9",
    theme_color: "#1e293b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
