import type { PropsWithChildren } from "react";

type Props = PropsWithChildren<{
  onClick: () => void;
}>;

export function BasicButton({ children, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-16 w-16 shrink-0 p-4 items-center justify-center rounded-full text-white shadow-md transition"
    >
      {children}
    </button>
  );
}
