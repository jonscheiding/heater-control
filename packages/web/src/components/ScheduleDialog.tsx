import { useEffect, useRef, useState } from "react";

import {
  toDatetimeLocalString,
  toTopOfReasonableHour,
} from "../schedules/format.js";

interface Props {
  open: boolean;
  heaterName: string;
  minIso: string;
  maxIso: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (startIso: string) => void;
}

export function ScheduleDialog({
  open,
  heaterName,
  minIso,
  maxIso,
  submitting,
  onCancel,
  onSubmit,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open) dlg.showModal();
    else dlg.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      className="rounded-lg p-0 backdrop:bg-black/40 m-auto"
    >
      {open && (
        <DialogBody
          heaterName={heaterName}
          minIso={minIso}
          maxIso={maxIso}
          submitting={submitting}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      )}
    </dialog>
  );
}

interface BodyProps {
  heaterName: string;
  minIso: string;
  maxIso: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (startIso: string) => void;
}

function DialogBody({
  heaterName,
  minIso,
  maxIso,
  submitting,
  onCancel,
  onSubmit,
}: BodyProps) {
  const [value, setValue] = useState(() =>
    toDatetimeLocalString(toTopOfReasonableHour(new Date(minIso))),
  );
  const minLocal = toDatetimeLocalString(new Date(minIso));
  const maxLocal = toDatetimeLocalString(new Date(maxIso));

  return (
    <form
      method="dialog"
      className="w-80 max-w-full p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (submitting) return;
        const picked = new Date(value);
        onSubmit(picked.toISOString());
      }}
    >
      <h2 className="text-lg font-semibold text-slate-900">
        Schedule {heaterName}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Auto-off applies once the switch turns on.
      </p>
      <label className="mt-4 block">
        <span className="text-sm font-medium text-slate-700">When</span>
        <input
          type="datetime-local"
          required
          min={minLocal}
          max={maxLocal}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-slate-900 min-w-0 appearance-none"
        />
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-4 py-2 text-slate-700 hover:bg-slate-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? "Scheduling…" : "Schedule"}
        </button>
      </div>
    </form>
  );
}
