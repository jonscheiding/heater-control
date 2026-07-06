import { STATUS_LABELS, type HeaterState } from "../heaters/state.js";

const COLOR_CLASSES: Record<HeaterState, string> = {
  off: "bg-red-600 hover:bg-red-500 active:bg-red-700",
  on: "bg-green-600 hover:bg-green-500 active:bg-green-700",
  "no-power": "bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600",
  waiting: "bg-gray-400 cursor-progress",
};

interface Props {
  state: HeaterState;
  label: string;
  onToggle: () => void;
}

export function PowerButton({ state, label, onToggle }: Props) {
  const color = COLOR_CLASSES[state];

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`${label}: ${STATUS_LABELS[state]}. Tap to toggle.`}
      className={`flex h-10 w-10 shrink-0 p-2 items-center justify-center rounded-full text-white shadow-md transition ${color}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-7 w-7"
        aria-hidden="true"
      >
        <path d="M12 2v10" />
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      </svg>
    </button>
  );
}
