"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { formatMoney } from "@/lib/money.mjs";

interface PurchaseEntity {
  id: string;
  name: string;
}

interface PurchaseRequest {
  id: string;
  entity_id: string;
  entity_name: string;
  description: string;
  amount: string;
  currency: "HTG" | "USD";
  status: "draft" | "pending" | "approved" | "rejected" | "ordered" | "received";
  created_at: string;
}

interface ApiError { error?: string }

const statusLabels: Record<PurchaseRequest["status"], Parameters<typeof translate>[1]> = {
  draft: "purchaseStatusDraft",
  pending: "purchaseStatusPending",
  approved: "purchaseStatusApproved",
  rejected: "purchaseStatusRejected",
  ordered: "purchaseStatusOrdered",
  received: "purchaseStatusReceived",
};

export function PurchaseRequestsManager({ locale }: { locale: Locale }) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [entities, setEntities] = useState<PurchaseEntity[]>([]);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [entityId, setEntityId] = useState("");
  const [editingRequestId, setEditingRequestId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"HTG" | "USD">("USD");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingStatusId, setSavingStatusId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/finance/purchase-requests");
    const body = await response.json() as ApiError & {
      entities?: PurchaseEntity[];
      requests?: PurchaseRequest[];
    };
    if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
    const availableEntities = body.entities ?? [];
    setEntities(availableEntities);
    setRequests(body.requests ?? []);
    setEntityId((current) => availableEntities.some((entity) => entity.id === current)
      ? current
      : availableEntities[0]?.id ?? "");
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    load().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : text("requestFailed"));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [load, text]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch("/api/v1/finance/purchase-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(editingRequestId ? { requestId: editingRequestId } : {}),
          entityId,
          description,
          amount,
          currency,
        }),
      });
      const body = await response.json() as ApiError;
      if (!response.ok) {
        setError(body.error ?? text("requestFailed"));
        return;
      }
      setEditingRequestId("");
      setDescription("");
      setAmount("");
      setNotice(text("purchaseRequestSubmitted"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  function editRequest(item: PurchaseRequest) {
    setEditingRequestId(item.id);
    setEntityId(item.entity_id);
    setDescription(item.description);
    setAmount(item.amount);
    setCurrency(item.currency);
    setError("");
    setNotice("");
  }

  function cancelEdit() {
    setEditingRequestId("");
    setDescription("");
    setAmount("");
  }

  async function updateStatus(item: PurchaseRequest, status: "ordered" | "received") {
    setError("");
    setNotice("");
    setSavingStatusId(item.id);
    try {
      const response = await fetch(`/api/v1/finance/purchase-requests/${item.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await response.json() as ApiError;
      if (!response.ok) {
        setError(body.error ?? text("requestFailed"));
        return;
      }
      setNotice(text("purchaseStatusUpdated"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSavingStatusId("");
    }
  }

  return (
    <section className="panel finance-panel purchase-requests-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{text("purchaseRequestsTitle").toUpperCase()}</span>
          <h2>{text("purchaseRequestsTitle")}</h2>
        </div>
        <span className="count-pill">{requests.length}</span>
      </div>
      <p className="panel-description">{text("purchaseRequestsDescription")}</p>
      <form className="purchase-request-form" onSubmit={(event) => void submit(event)}>
        <label>
          {text("purchaseEntity")}
          <select value={entityId} onChange={(event) => setEntityId(event.target.value)} required disabled={!entities.length}>
            {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
        </label>
        <label>
          {text("purchaseDescription")}
          <input value={description} onChange={(event) => setDescription(event.target.value)} required maxLength={1000} />
        </label>
        <label>
          {text("purchaseAmount")}
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </label>
        <label>
          {text("purchaseCurrency")}
          <select value={currency} onChange={(event) => setCurrency(event.target.value as "HTG" | "USD")}>
            <option value="USD">USD</option>
            <option value="HTG">HTG</option>
          </select>
        </label>
        <button className="button button-primary" type="submit" disabled={saving || loading || !entityId}>
          {saving ? text("saving") : text(editingRequestId ? "resubmitPurchaseRequest" : "submitPurchaseRequest")}
        </button>
        {editingRequestId && <button className="button button-secondary" type="button" onClick={cancelEdit}>
          {text("cancel")}
        </button>}
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {loading ? <p className="muted">{text("loading")}</p> : requests.length ? (
        <div className="purchase-request-list">
          {requests.map((item) => (
            <article className="purchase-request-row" key={item.id}>
              <div>
                <strong>{item.description}</strong>
                <p>{item.entity_name} · {text(statusLabels[item.status])}</p>
                {item.status === "draft" && <button className="table-action" type="button" onClick={() => editRequest(item)}>
                  {text("editPurchaseRequest")}
                </button>}
                {item.status === "approved" && <button className="table-action" type="button"
                  disabled={savingStatusId === item.id}
                  onClick={() => void updateStatus(item, "ordered")}>
                  {savingStatusId === item.id ? text("saving") : text("markPurchaseOrdered")}
                </button>}
                {item.status === "ordered" && <button className="table-action" type="button"
                  disabled={savingStatusId === item.id}
                  onClick={() => void updateStatus(item, "received")}>
                  {savingStatusId === item.id ? text("saving") : text("markPurchaseReceived")}
                </button>}
              </div>
              <strong>{formatMoney(item.amount, item.currency, locale)}</strong>
            </article>
          ))}
        </div>
      ) : <p className="empty-state">{text("purchaseRequestsEmpty")}</p>}
    </section>
  );
}
