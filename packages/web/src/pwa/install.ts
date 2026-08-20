import { useCallback, useSyncExternalStore } from "react";

import { detectInstallMethod, type InstallMethod } from "./platform.js";

/** Chromium's install event, which TypeScript's DOM lib doesn't know about. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const SNOOZE_KEY = "install-offer-snoozed-until";
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

const STANDALONE_QUERY = "(display-mode: standalone)";

interface Snapshot {
  promptEvent: BeforeInstallPromptEvent | null;
  installed: boolean;
  snoozedUntil: number;
}

let snapshot: Snapshot = {
  promptEvent: null,
  installed: isStandalone(),
  snoozedUntil: readSnooze(),
};

const listeners = new Set<() => void>();

function update(patch: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // `navigator.standalone` is the iOS-only equivalent, still needed for home
  // screen apps on older iOS.
  const iosStandalone = (navigator as { standalone?: boolean }).standalone;
  return window.matchMedia(STANDALONE_QUERY).matches || iosStandalone === true;
}

function readSnooze(): number {
  if (typeof localStorage === "undefined") return 0;
  const raw = localStorage.getItem(SNOOZE_KEY);
  const until = raw == null ? NaN : Number(raw);
  return Number.isFinite(until) ? until : 0;
}

if (typeof window !== "undefined") {
  // Chromium fires this early — before React mounts — so the listener is
  // registered at module load and the event parked until something asks.
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppress Chrome's own mini-infobar; we offer the install ourselves.
    event.preventDefault();
    update({ promptEvent: event as BeforeInstallPromptEvent });
  });

  window.addEventListener("appinstalled", () => {
    update({ promptEvent: null, installed: true });
  });

  window.matchMedia(STANDALONE_QUERY).addEventListener("change", (event) => {
    update({ installed: event.matches });
  });
}

export interface InstallOffer {
  /** "none" when there is nothing to offer, or nothing worth offering. */
  method: InstallMethod;
  /** Runs the browser's install flow. Only meaningful for `method: "prompt"`. */
  install: () => void;
  /** Hides the offer for a month. */
  snooze: () => void;
}

export function useInstallOffer(): InstallOffer {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );

  const install = useCallback(() => {
    const event = snapshot.promptEvent;
    if (event == null) return;
    // The event is single-use: drop it either way so the offer disappears.
    update({ promptEvent: null });
    void event.prompt();
  }, []);

  const snooze = useCallback(() => {
    const until = Date.now() + SNOOZE_MS;
    try {
      localStorage.setItem(SNOOZE_KEY, String(until));
    } catch {
      // Private browsing, quota, etc. — the offer just comes back next visit.
    }
    update({ snoozedUntil: until });
  }, []);

  const method =
    state.installed || Date.now() < state.snoozedUntil
      ? "none"
      : detectInstallMethod({
          userAgent: navigator.userAgent,
          maxTouchPoints: navigator.maxTouchPoints,
          hasPromptEvent: state.promptEvent != null,
        });

  return { method, install, snooze };
}
