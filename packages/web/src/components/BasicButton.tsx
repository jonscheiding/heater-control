import type { PropsWithChildren } from "react";

import styles from "./BasicButton.module.css";

type Props = PropsWithChildren<{
  onClick: () => void;
}>;

export function BasicButton({
  children,
  onClick,
}: Props & { disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={styles.button}>
      {children}
    </button>
  );
}
