import styles from "./Banner.module.css";
import { Button } from "./ui/Button.js";
import { Header } from "./ui/Header.js";

interface Props {
  username: string | null;
  onLogout?: (() => void) | undefined;
}

export function Banner({ username, onLogout }: Props) {
  return (
    <Header>
      <div>
        <h1 className={styles.title}>Flying Neutrons Airplane Heaters</h1>
        {username && <p className={styles.welcome}>Welcome, {username}</p>}
      </div>
      {onLogout && (
        <Button className={styles.logout} onClick={() => onLogout()}>
          Log out
        </Button>
      )}
    </Header>
  );
}
