import styles from "./Banner.module.css";

interface Props {
  username: string | null;
  onLogout?: (() => void) | undefined;
}

export function Banner({ username, onLogout }: Props) {
  return (
    <header className={styles.banner}>
      <div className={styles.row}>
        <div>
          <h1 className={styles.title}>Flying Neutrons Airplane Heaters</h1>
          {username && <p className={styles.welcome}>Welcome, {username}</p>}
        </div>
        {onLogout && (
          <button type="button" onClick={onLogout} className={styles.logout}>
            Log out
          </button>
        )}
      </div>
    </header>
  );
}
