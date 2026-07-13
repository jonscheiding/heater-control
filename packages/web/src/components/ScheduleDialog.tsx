import { useEffect, useRef, useState } from "react";

import {
  toDatetimeLocalString,
  toTopOfReasonableHour,
} from "../schedules/format.js";
import styles from "./ScheduleDialog.module.css";

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
    <dialog ref={ref} onClose={onCancel}>
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
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (submitting) return;
        const picked = new Date(value);
        onSubmit(picked.toISOString());
      }}
    >
      <h2 className={styles.title}>Schedule {heaterName}</h2>
      <p className={styles.subtitle}>
        Auto-off applies once the switch turns on.
      </p>
      <label className={styles.field}>
        <span className={styles.label}>When</span>
        <input
          type="datetime-local"
          required
          min={minLocal}
          max={maxLocal}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          className={styles.input}
        />
      </label>
      <div className={styles.actions}>
        <button
          type="button"
          onClick={onCancel}
          className={styles.cancelButton}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className={styles.submitButton}
        >
          {submitting ? "Scheduling…" : "Schedule"}
        </button>
      </div>
    </form>
  );
}
