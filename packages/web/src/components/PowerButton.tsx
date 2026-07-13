import { STATUS_LABELS, type HeaterState } from "../heaters/state.js";
import styles from "./PowerButton.module.css";

const COLOR_CLASSES: Record<HeaterState, string | undefined> = {
  off: styles.off,
  on: styles.on,
  "no-power": styles.noPower,
  waiting: styles.waiting,
};

interface Props {
  state: HeaterState;
  label: string;
  isLoading?: boolean;
  onToggle: () => void;
}

export function PowerButton({
  state,
  label,
  isLoading = false,
  onToggle,
}: Props) {
  const color =
    (isLoading ? COLOR_CLASSES.waiting : COLOR_CLASSES[state]) ?? "";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isLoading}
      aria-busy={isLoading}
      aria-label={`${label}: ${STATUS_LABELS[state]}. Tap to toggle.`}
      className={`${styles.button} ${color}`}
    >
      {isLoading ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          className={styles.spinner}
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={styles.icon}
          aria-hidden="true"
        >
          <path d="M12 2v10" />
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
        </svg>
      )}
    </button>
  );
}
