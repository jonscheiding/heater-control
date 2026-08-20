import { describe, expect, it } from "vitest";

import { detectInstallMethod } from "../src/pwa/platform.js";

// Representative user agents, trimmed of the bits nothing keys off.
const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  // iPadOS asks for desktop sites by default, so it lies about being a Mac.
  ipadOS:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  macFirefox:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
};

describe("detectInstallMethod", () => {
  it("drives the install itself once Chromium offers a prompt", () => {
    for (const userAgent of [UA.androidChrome, UA.macChrome, UA.windowsEdge]) {
      expect(
        detectInstallMethod({
          userAgent,
          maxTouchPoints: 0,
          hasPromptEvent: true,
        }),
      ).toBe("prompt");
    }
  });

  it("sends every iOS browser to the share sheet", () => {
    for (const userAgent of [UA.iphoneSafari, UA.iphoneChrome]) {
      expect(
        detectInstallMethod({
          userAgent,
          maxTouchPoints: 5,
          hasPromptEvent: false,
        }),
      ).toBe("ios-share");
    }
  });

  it("treats a touch-capable 'Mac' as an iPad", () => {
    expect(
      detectInstallMethod({
        userAgent: UA.ipadOS,
        maxTouchPoints: 5,
        hasPromptEvent: false,
      }),
    ).toBe("ios-share");
  });

  it("sends macOS Safari to the Dock, not the share sheet", () => {
    expect(
      detectInstallMethod({
        userAgent: UA.macSafari,
        maxTouchPoints: 0,
        hasPromptEvent: false,
      }),
    ).toBe("safari-dock");
  });

  it("does not mistake Chrome's user agent for Safari", () => {
    expect(
      detectInstallMethod({
        userAgent: UA.macChrome,
        maxTouchPoints: 0,
        hasPromptEvent: false,
      }),
    ).toBe("none");
  });

  it("offers nothing where we have no install path", () => {
    for (const userAgent of [UA.macFirefox, UA.androidChrome]) {
      expect(
        detectInstallMethod({
          userAgent,
          maxTouchPoints: 0,
          hasPromptEvent: false,
        }),
      ).toBe("none");
    }
  });
});
