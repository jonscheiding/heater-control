/**
 * How — or whether — the current browser lets the user install the app.
 *
 * Chromium fires `beforeinstallprompt` and we can drive the install ourselves.
 * WebKit never has, so on Apple platforms the best we can do is point at the
 * menu item that does it; the two menus are different enough to be worth
 * telling apart.
 */
export type InstallMethod = "prompt" | "ios-share" | "safari-dock" | "none";

export interface BrowserInfo {
  userAgent: string;
  /** iPads report a Mac user agent, but a Mac has no touch screen. */
  maxTouchPoints: number;
  /** Whether a `beforeinstallprompt` event has been captured. */
  hasPromptEvent: boolean;
}

export function detectInstallMethod({
  userAgent,
  maxTouchPoints,
  hasPromptEvent,
}: BrowserInfo): InstallMethod {
  if (hasPromptEvent) return "prompt";

  const isMacLike = /Macintosh|Mac OS X/.test(userAgent);

  // Every iOS browser is WebKit underneath and installs through the share
  // sheet, so the engine — not the brand — is what matters here.
  if (/iPhone|iPod|iPad/.test(userAgent)) return "ios-share";
  if (isMacLike && maxTouchPoints > 1) return "ios-share";

  // Safari 17+ on macOS: File → Add to Dock. Chrome and friends put "Safari"
  // in their user agents too, hence the exclusions.
  const isSafari =
    /Safari/.test(userAgent) &&
    !/Chrome|Chromium|Edg\/|OPR\/|Firefox/.test(userAgent);
  if (isMacLike && isSafari) return "safari-dock";

  // Chromium that never offered a prompt (already installed, or the site
  // doesn't qualify), Firefox on the desktop, or something unknown.
  return "none";
}
