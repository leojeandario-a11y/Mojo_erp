"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { formatMoney } from "@/lib/money.mjs";

interface ApprovalRequest {
  id: string;
  ref_id: string;
  title: string;
  amount: string;
  currency: "HTG" | "USD";
  created_at: string;
  requester_name: string;
  step_label: string;
  entity_name: string;
}
interface ApiError { error?: string }

export function ApprovalsManager({ locale }: { locale: Locale }) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/approvals");
    const body = await response.json() as { requests?: ApprovalRequest[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
    setRequests(body.requests ?? []);
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

  async function decide(requestId: string, decision: "approved" | "rejected") {
    setError("");
    setNotice("");
    setSavingId(requestId);
    try {
      const response = await fetch(`/api/v1/approvals/${requestId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, comment: null }),
      });
      const body = await response.json() as ApiError;
      if (!response.ok) {
        setError(body.error ?? text("requestFailed"));
        return;
      }
      setNotice(text(decision === "approved" ? "approvalRecorded" : "rejectionRecorded"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSavingId("");
    }
  }

  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{text("approvals").toUpperCase()}</span>
          <h1>{text("approvalInbox")}<span className="heading-period">.</span></h1>
          <p>{text("approvalInboxDescription")}</p>
        </div>
      </div>
      <section className="panel finance-panel approval-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">{text("requestsNote").toUpperCase()}</span><h2>{text("pendingApprovals")}</h2></div>
          <span className="count-pill">{requests.length}</span>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="success-message" role="status">{notice}</p>}
        {loading ? <p className="muted">{text("loading")}</p> : requests.length ? (
          <div className="approval-list">
            {requests.map((item) => (
              <article className="approval-card" key={item.id}>
                <div className="approval-card-heading">
                  <div><h3>{item.title}</h3><p>{item.entity_name} · {item.step_label}</p></div>
                  <strong>{formatMoney(item.amount, item.currency, locale)}</strong>
                </div>
                <p className="approval-card-meta">
                  {text("approvalRequester")}: {item.requester_name} · {new Intl.DateTimeFormat(
                    locale === "ht" ? "ht-HT" : locale,
                    { dateStyle: "medium", timeStyle: "short" },
                  ).format(new Date(item.created_at))}
                </p>
                <div className="approval-card-actions">
                  <button className="button button-secondary" type="button" disabled={savingId === item.id}
                    onClick={() => void decide(item.id, "rejected")}>
                    {text("rejectApproval")}
                  </button>
                  <button className="button button-primary" type="button" disabled={savingId === item.id}
                    onClick={() => void decide(item.id, "approved")}>
                    {savingId === item.id ? text("saving") : text("approveRequest")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="empty-state">{text("noPendingApprovals")}</p>}
      </section>
    </div>
  );
}
