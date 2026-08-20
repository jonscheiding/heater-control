import { describe, expect, it } from "vitest";

import { buildWebManifest } from "../src/pwa/manifest.js";

describe("buildWebManifest", () => {
  it("names the installed app after the running app", () => {
    expect(buildWebManifest("Flying Neutrons Heater Control")).toMatchObject({
      name: "Flying Neutrons Heater Control",
    });
  });

  it("carries what browsers require before they offer to install", () => {
    const manifest = buildWebManifest("Heater Control");

    expect(manifest).toMatchObject({
      start_url: "/",
      display: "standalone",
    });

    // Chromium wants a 192px and a 512px icon; Android launchers want a
    // maskable one so the artwork survives being cropped to a circle.
    const icons = manifest.icons as { sizes: string; purpose?: string }[];
    expect(icons.map((icon) => icon.sizes)).toContain("192x192");
    expect(icons.map((icon) => icon.sizes)).toContain("512x512");
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });
});
