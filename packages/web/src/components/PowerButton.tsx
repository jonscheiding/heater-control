import { STATUS_LABELS, type HeaterState } from "../heaters/state.js";
import styles from "./PowerButton.module.css";
import { Button } from "./ui/Button.js";
import { IconPower } from "./ui/IconPower.js";
import { IconPowerOff } from "./ui/IconPowerUnavailable.js";
import { Spinner } from "./ui/Spinner.js";

const COLOR_CLASSES: Record<HeaterState, string | undefined> = {
  off: styles.off,
  on: styles.on,
  "no-power": styles.noPower,
  waiting: styles.waiting,
  unreachable: styles.unreachable,
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
  const unreachable = state === "unreachable";

  return (
    <Button
      round
      onClick={onToggle}
      disabled={isLoading || unreachable}
      aria-busy={isLoading}
      aria-label={
        unreachable
          ? `${label}: ${STATUS_LABELS[state]}. Cannot be controlled right now.`
          : `${label}: ${STATUS_LABELS[state]}. Tap to toggle.`
      }
      className={color}
    >
      {isLoading ? <Spinner /> : unreachable ? <IconPowerOff /> : <IconPower />}
    </Button>
  );
}
