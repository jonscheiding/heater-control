import { useEffect, useRef, useState } from "react";

import { useInstallOffer } from "../pwa/install.js";
import type { InstallMethod } from "../pwa/platform.js";
import styles from "./InstallPrompt.module.css";
import { Button } from "./ui/Button.js";

const COPY: Record<
  Exclude<InstallMethod, "none">,
  { blurb: string; action: string }
> = {
  prompt: {
    blurb: "Launch it without the browser.",
    action: "Install",
  },
  "ios-share": {
    blurb: "Keep it on your Home Screen.",
    action: "How?",
  },
  "safari-dock": {
    blurb: "Keep it in your Dock.",
    action: "How?",
  },
};

/**
 * Offers to install the app: one tap in Chromium, step-by-step directions on
 * Apple platforms, where the browser only installs from its own menus.
 */
export function InstallPrompt() {
  const { method, install, snooze } = useInstallOffer();
  const [showingHelp, setShowingHelp] = useState(false);

  if (method === "none") return null;

  const { blurb, action } = COPY[method];

  return (
    <>
      <div className={styles.bar}>
        <img src="/icon-192.png" alt="" className={styles.icon} />
        <div className={styles.text}>
          <p className={styles.title}>Install the app</p>
          <p className={styles.blurb}>{blurb}</p>
        </div>
        <Button
          className={styles.action}
          onClick={() => {
            if (method === "prompt") install();
            else setShowingHelp(true);
          }}
        >
          {action}
        </Button>
        <button
          type="button"
          aria-label="Not now"
          className={styles.dismiss}
          onClick={() => {
            snooze();
          }}
        >
          &times;
        </button>
      </div>
      <InstallHelpDialog
        method={method}
        open={showingHelp}
        onClose={() => {
          setShowingHelp(false);
        }}
      />
    </>
  );
}

interface HelpProps {
  method: InstallMethod;
  open: boolean;
  onClose: () => void;
}

function InstallHelpDialog({ method, open, onClose }: HelpProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) dialog.showModal();
    else dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} onClose={onClose}>
      <div className={styles.help}>
        <h2 className={styles.helpTitle}>
          {method === "safari-dock"
            ? "Add it to your Dock"
            : "Add it to your Home Screen"}
        </h2>
        {method === "safari-dock" ? (
          <ol className={styles.steps}>
            <li>
              In Safari&rsquo;s menu bar, choose <strong>File</strong>.
            </li>
            <li>
              Choose <strong>Add to Dock</strong>.
            </li>
            <li>
              Click <strong>Add</strong>.
            </li>
          </ol>
        ) : (
          <ol className={styles.steps}>
            <li>
              Tap the <strong>Share</strong> button &mdash; the square with an
              arrow pointing out of it.
            </li>
            <li>
              Scroll down and tap <strong>Add to Home Screen</strong>.
            </li>
            <li>
              Tap <strong>Add</strong>.
            </li>
          </ol>
        )}
        <div className={styles.helpActions}>
          <Button onClick={onClose} className={styles.helpDone}>
            Got it
          </Button>
        </div>
      </div>
    </dialog>
  );
}
