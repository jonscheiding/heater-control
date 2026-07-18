import type { PropsWithChildren } from "react";
import styles from "./Header.module.css";

export function Header({ children }: PropsWithChildren) {
  return (
    <header className={styles.header}>
      <div className={styles.row}>{children}</div>
    </header>
  );
}
