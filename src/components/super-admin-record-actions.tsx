"use client";

import { useEffect, useRef, type ReactNode } from "react";

export interface RecordDetail {
  title: string;
  fields: Array<{ label: string; value: ReactNode }>;
}

export interface RecordActionLabels {
  open: string;
  edit: string;
  delete: string;
}

export function SuperAdminRecordActions({
  isSuperAdmin,
  labels,
  onOpen,
  onEdit,
  onDelete,
  editDisabled = false,
  deleteDisabled = false,
  editTitle,
  deleteTitle,
}: {
  isSuperAdmin: boolean;
  labels: RecordActionLabels;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  editDisabled?: boolean;
  deleteDisabled?: boolean;
  editTitle?: string;
  deleteTitle?: string;
}) {
  if (!isSuperAdmin) return null;

  return (
    <div className="super-admin-record-actions">
      <button className="record-icon-action" type="button" aria-label={labels.open} title={labels.open} onClick={onOpen}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
      </button>
      <button className="record-icon-action" type="button" aria-label={labels.edit} title={editTitle ?? labels.edit} onClick={onEdit} disabled={editDisabled}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5Z" /><path d="m14.8 5.7 3.5 3.5" /></svg>
      </button>
      <button className="record-icon-action record-icon-action-danger" type="button" aria-label={labels.delete} title={deleteTitle ?? labels.delete} onClick={onDelete} disabled={deleteDisabled}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" /></svg>
      </button>
    </div>
  );
}

export function RecordDetailsDialog({
  detail,
  closeLabel,
  onClose,
}: {
  detail: RecordDetail | null;
  closeLabel: string;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!detail) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [detail]);

  if (!detail) return null;

  return (
    <div className="record-details-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="record-details-dialog" role="dialog" aria-modal="true" aria-labelledby="record-details-title">
        <div className="record-details-heading">
          <h2 id="record-details-title">{detail.title}</h2>
          <button ref={closeButtonRef} className="button button-secondary" type="button" onClick={onClose}>{closeLabel}</button>
        </div>
        <dl>{detail.fields.map((field) => (
          <div key={field.label}><dt>{field.label}</dt><dd>{field.value || "—"}</dd></div>
        ))}</dl>
      </section>
    </div>
  );
}
