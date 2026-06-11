import { useAuth } from "react-oidc-context";
import { Devices } from "./pages/Devices.js";

export function App() {
  const auth = useAuth();

  if (auth.isLoading) {
    return <main className="centered">Loading…</main>;
  }

  if (auth.error) {
    return (
      <main className="centered">
        <p>Sign-in error: {auth.error.message}</p>
        <button onClick={() => void auth.signinRedirect()}>Try again</button>
      </main>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <main className="centered">
        <h1>Heater Control</h1>
        <button onClick={() => void auth.signinRedirect()}>Sign in</button>
      </main>
    );
  }

  return (
    <main>
      <header>
        <h1>Heater Control</h1>
        <button onClick={() => void auth.removeUser()}>Sign out</button>
      </header>
      <Devices />
    </main>
  );
}
