interface Props {
  state: "on" | "off";
  pending: boolean;
  onToggle: (next: "on" | "off") => void;
}

export function SwitchControl({ state, pending, onToggle }: Props) {
  const next = state === "on" ? "off" : "on";
  return (
    <button
      className={`switch switch-${state}`}
      disabled={pending}
      onClick={() => onToggle(next)}
    >
      {pending ? "…" : state.toUpperCase()}
    </button>
  );
}
