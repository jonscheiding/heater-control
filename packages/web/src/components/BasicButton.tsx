import type { PropsWithChildren } from "react";

type Props = PropsWithChildren<{
  onClick: () => void;
}>;

export function BasicButton({
  children,
  onClick,
}: Props & { disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-10 shrink-0 p-4 items-center justify-center rounded-full text-black text-xs bg-taupe-100 shadow-md transition"
    >
      {children}
    </button>
  );
}
