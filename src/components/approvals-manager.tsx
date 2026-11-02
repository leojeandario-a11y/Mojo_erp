"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { formatMoney } from "@/lib/money.mjs";

interface ApprovalRequest {
  id: string;
  request_type: "expense" | "purchase" | "budget" | "fund_rate" | "fund_withdrawal";
  ref_id: string;
  title: string;
  amount: string;
  currency: "HTG" | "USD";
  status: "pending" | "approved" | "rejected" | "cancelled" | "returned";
  created_at: string;
  closed_at: string | null;
  requester_id: string;
  requester_name: string;
  step_label: string | null;
  entity_name: string;
  actions: {
    decision: "approved" | "rejected" | "returned";
    comment: string | null;
    actor_name: string;
    acted_at: string;
  }[];
}
interface ApiError { error?: string }
type ApprovalView = "queue" | "mine" | "history";

const viewLabels: Record<ApprovalView, Parameters<typeof translate>[1]> = {
  queue: "approvalQueueTab",
  mine: "myApprovalRequestsTab",
  history: "approvalHistoryTab",
};
const statusLabels: Record<ApprovalRequest["status"], Parameters<typeof translate>[1]> = {
  pending: "approvalStatusPending",
  approved: "approvalStatusApproved",
  rejected: "approvalStatusRejected",
  cancelled: "approvalStatusCancelled",
  returned: "approvalStatusReturned",
};
const actionLabels: Record<ApprovalRequest["actions"][number]["decision"], Parameters<typeof translate>[1]> = {
  approved: "approveRequest",
  rejected: "rejectApproval",
  returned: "returnApproval",
};
const emptyStateLabels: Record<ApprovalView, Parameters<typeof translate>[1]> = {
  queue: "noPendingApprovals",
  mine: "noMyApprovalRequests",
  history: "noApprovalHistory",
};
const requestTypeLabels: Record<ApprovalRequest["request_type"], Parameters<typeof translate>[1]> = {
  expense: "approvalTypeExpense",
  purchase: "approvalTypePurchase",
  budget: "approvalTypeBudget",
  fund_rate: "approvalTypeFundRate",
  fund_withdrawal: "approvalTypeFundWithdrawal",
};

export function ApprovalsManager({ locale }: { locale: Locale }) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [data, setData] = useState<Record<ApprovalView, ApprovalRequest[]>>({
    queue: [], mine: [], history: [],
  });
  const [currentView, setCurrentView] = useState<ApprovalView>("queue");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [returnComments, setReturnComments] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/approvals");
    const body = await response.json() as Partial<Record<ApprovalView, ApprovalRequest[]>> & ApiError;
    if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
    setData({
      queue: body.queue ?? [],
      mine: body.mine ?? [],
      history: body.history ?? [],
    });
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

  async function decide(requestId: string, decision: "approved" | "rejected" | "returned") {
    setError("");
    setNotice("");
    setSavingId(requestId);
    try {
      const response = await fetch(`/api/v1/approvals/${requestId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          comment: decision === "returned" ? returnComments[requestId]?.trim() || null : null,
        }),
      });
      const body = await response.json() as ApiError;
      if (!response.ok) {
        setError(body.error ?? text("requestFailed"));
        return;
      }
      setNotice(text(decision === "approved"
        ? "approvalRecorded"
        : decision === "rejected" ? "rejectionRecorded" : "approvalReturned"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSavingId("");
    }
  }

  function statusLabel(status: ApprovalRequest["status"]) {
    return text(statusLabels[status]);
  }

  function actionLabel(decision: ApprovalRequest["actions"][number]["decision"]) {
    return text(actionLabels[decision]);
  }

  const requests = data[currentView];

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
          <div><span className="eyebrow">{text("requestsNote").toUpperCase()}</span><h2>{text(viewLabels[currentView])}</h2></div>
          <span className="count-pill">{requests.length}</span>
        </div>
        <div className="approval-tabs" role="tablist" aria-label={text("approvalInbox")}>
          {(Object.keys(viewLabels) as ApprovalView[]).map((view) => (
            <button
              key={view}
              id={`approval-tab-${view}`}
              className={`approval-tab ${currentView === view ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={currentView === view}
              aria-controls={`approval-panel-${view}`}
              onClick={() => setCurrentView(view)}
            >
              {text(viewLabels[view])}
              <span className="count-pill">{data[view].length}</span>
            </button>
          ))}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="success-message" role="status">{notice}</p>}
        <div id={`approval-panel-${currentView}`} role="tabpanel" aria-labelledby={`approval-tab-${currentView}`}>
          {loading ? <p className="muted">{text("loading")}</p> : requests.length ? (
            <div className="approval-list">
              {requests.map((item) => (
                <article className="approval-card" key={item.id}>
                  <div className="approval-card-heading">
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.entity_name}{item.step_label ? ` · ${item.step_label}` : ""}</p>
                    </div>
                    <strong>{formatMoney(item.amount, item.currency, locale)}</strong>
                  </div>
                  <p className="approval-card-meta">
                    {text(requestTypeLabels[item.request_type])} · {text("approvalRequester")}: {item.requester_name} · {new Intl.DateTimeFormat(
                      locale === "ht" ? "ht-HT" : locale,
                      { dateStyle: "medium", timeStyle: "short" },
                    ).format(new Date(item.created_at))}
                  </p>
                  {currentView !== "queue" && (
                    <p className="approval-card-status">
                      <strong>{text("state")}:</strong> {statusLabel(item.status)}
                      {item.closed_at && ` · ${new Intl.DateTimeFormat(
                        locale === "ht" ? "ht-HT" : locale,
                        { dateStyle: "medium", timeStyle: "short" },
                      ).format(new Date(item.closed_at))}`}
                    </p>
                  )}
                  {currentView === "queue"
                    && item.request_type !== "fund_rate"
                    && item.request_type !== "fund_withdrawal" && <label className="approval-return-comment">
                    {text("returnApprovalComment")}
                    <textarea
                      maxLength={1000}
                      value={returnComments[item.id] ?? ""}
                      onChange={(event) => setReturnComments((current) => ({ ...current, [item.id]: event.target.value }))}
                    />
                  </label>}
                  {item.actions.length > 0 && (
                    <ol className="approval-action-history">
                      {item.actions.map((action, index) => (
                        <li key={`${item.id}-${index}`}>
                          <strong>{actionLabel(action.decision)}</strong> · {action.actor_name}
                          {" · "}{new Intl.DateTimeFormat(
                            locale === "ht" ? "ht-HT" : locale,
                            { dateStyle: "medium", timeStyle: "short" },
                          ).format(new Date(action.acted_at))}
                          {action.comment && <p>{action.comment}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                  {currentView === "queue" && <div className="approval-card-actions">
                    {item.request_type !== "fund_rate" && item.request_type !== "fund_withdrawal" && (
                      <button className="button button-secondary" type="button" disabled={savingId === item.id}
                        onClick={() => void decide(item.id, "returned")}>
                        {text("returnApproval")}
                      </button>
                    )}
                    <button className="button button-secondary" type="button" disabled={savingId === item.id}
                      onClick={() => void decide(item.id, "rejected")}>
                      {text("rejectApproval")}
                    </button>
                    <button className="button button-primary" type="button" disabled={savingId === item.id}
                      onClick={() => void decide(item.id, "approved")}>
                      {savingId === item.id ? text("saving") : text("approveRequest")}
                    </button>
                  </div>}
                </article>
              ))}
            </div>
          ) : <p className="empty-state">{text(emptyStateLabels[currentView])}</p>}
        </div>
      </section>
    </div>
  );
}
