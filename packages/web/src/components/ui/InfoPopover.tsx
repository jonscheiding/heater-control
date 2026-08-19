import { useEffect, useRef, useState } from "react";

import { IconInfo } from "./IconInfo.js";
import styles from "./InfoPopover.module.css";

interface Props {
  /** One paragraph per line. */
  lines: string[];
  /** Accessible label for the trigger button. */
  label: string;
  icon?: () => React.ReactElement;
}

/** An info icon that toggles a small popover on click — works on touch, where
 * native hover tooltips don't. Closes on outside tap or Escape. */
export function InfoPopover({ lines, label, icon }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  const IconComponent = icon ?? IconInfo;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className={styles.wrapper} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <IconComponent />
      </button>
      {open && (
        <div className={styles.popover} role="tooltip">
          {lines.map((line, i) => (
            <p key={`${i}-${line}`} className={styles.line}>
              {line}
            </p>
          ))}
        </div>
      )}
    </span>
  );
}
