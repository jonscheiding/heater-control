import type { PropsWithChildren } from "react";
import cx from "classnames";

import styles from "./Button.module.css";

type Props = PropsWithChildren<{
  onClick?: (() => void) | undefined;
  disabled?: boolean;
  className?: string | undefined;
  round?: boolean;
}>;

export function Button({
  children,
  onClick,
  disabled,
  round,
  className,
}: Props & { disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        onClick?.();
      }}
      disabled={disabled}
      className={cx(styles.button, round && styles.round, className)}
    >
      {children}
    </button>
  );
}
