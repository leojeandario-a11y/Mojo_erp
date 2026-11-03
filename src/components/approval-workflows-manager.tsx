"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface WorkflowStep {
  id?: string;
  step_order?: number;
  label: string;
  approver_role_id: string | null;
  approver_user_id: string | null;
  min_amount_usd: string | null;
}

interface ApprovalWorkflow {
  id: string;
  request_type: string;
  entity_id: string | null;
  entity_name: string | null;
  name: string;
  is_active: boolean;
  steps: WorkflowStep[];
}

interface WorkflowData {
  workflows: ApprovalWorkflow[];
  roles: { id: string; name: string }[];
  users: { id: string; full_name: string }[];
}

interface ApiError { error?: string }

export function ApprovalWorkflowsManager({ locale }: { locale: Locale }) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [data, setData] = useState<WorkflowData>({ workflows: [], roles: [], users: [] });
  const [savedWorkflows, setSavedWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = data.workflows.find((workflow) => workflow.id === selectedId);
  const savedSelected = savedWorkflows.find((workflow) => workflow.id === selectedId);
  const isDirty = Boolean(selected && savedSelected && JSON.stringify(selected) !== JSON.stringify(savedSelected));

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/approvals/workflows");
    const body = await response.json() as WorkflowData & ApiError;
    if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
    setData(body);
    setSavedWorkflows(body.workflows);
    setSelectedId((current) => body.workflows.some((workflow) => workflow.id === current)
      ? current
      : body.workflows[0]?.id ?? "");
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

  function updateWorkflow(update: (workflow: ApprovalWorkflow) => ApprovalWorkflow) {
    if (!selected) return;
    setData((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) => workflow.id === selected.id ? update(workflow) : workflow),
    }));
  }

  function updateStep(index: number, update: (step: WorkflowStep) => WorkflowStep) {
    updateWorkflow((workflow) => ({
      ...workflow,
      steps: workflow.steps.map((step, stepIndex) => stepIndex === index ? update(step) : step),
    }));
  }

  function moveStep(index: number, direction: -1 | 1) {
    updateWorkflow((workflow) => {
      const target = index + direction;
      if (target < 0 || target >= workflow.steps.length) return workflow;
      const steps = [...workflow.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...workflow, steps };
    });
  }

  async function saveWorkflow() {
    if (!selected) return;
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/approvals/workflows?id=${selected.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: selected.name,
          isActive: selected.is_active,
          steps: selected.steps.map((step) => ({
            label: step.label,
            approverRoleId: step.approver_role_id,
            approverUserId: step.approver_user_id,
            minAmountUsd: step.min_amount_usd,
          })),
        }),
      });
      const body = await response.json() as ApiError;
      if (!response.ok) {
        setError(body.error ?? text("requestFailed"));
        return;
      }
      setNotice(text("workflowSaved"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel finance-panel workflow-panel">
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {loading ? <p className="muted">{text("loading")}</p> : data.workflows.length ? (
        <>
          <label className="workflow-select">
            {text("selectWorkflow")}
            <select value={selectedId} disabled={saving} onChange={(event) => {
              if (isDirty && !window.confirm(text("discardWorkflowChanges"))) return;
              if (isDirty) setData((current) => ({ ...current, workflows: savedWorkflows }));
              setSelectedId(event.target.value);
              setError("");
              setNotice("");
            }}>
              {data.workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name} · {workflow.entity_name ?? text("globalWorkflow")}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <div className="workflow-editor">
              <div className="workflow-editor-heading">
                <div>
                  <span className="eyebrow">{selected.request_type.toUpperCase()}</span>
                  <h2>{selected.name}</h2>
                </div>
                <label className="workflow-active-toggle">
                  <input
                    type="checkbox"
                    checked={selected.is_active}
                    disabled={saving}
                    onChange={(event) => updateWorkflow((workflow) => ({ ...workflow, is_active: event.target.checked }))}
                  />
                  {text(selected.is_active ? "workflowActive" : "workflowInactive")}
                </label>
              </div>
              <label className="workflow-name">
                {text("name")}
                <input
                  maxLength={120}
                  minLength={2}
                  required
                  value={selected.name}
                  disabled={saving}
                  onChange={(event) => updateWorkflow((workflow) => ({ ...workflow, name: event.target.value }))}
                />
              </label>
              <div className="workflow-step-list">
                {selected.steps.map((step, index) => (
                  <article className="workflow-step" key={step.id ?? `${selected.id}-${index}`}>
                    <div className="workflow-step-heading">
                      <strong>{text("workflowStep")} {index + 1}</strong>
                      <div>
                        <button className="table-action" type="button" aria-label={text("moveUp")}
                          disabled={saving || index === 0} onClick={() => moveStep(index, -1)}>↑</button>
                        <button className="table-action" type="button" aria-label={text("moveDown")}
                          disabled={saving || index === selected.steps.length - 1} onClick={() => moveStep(index, 1)}>↓</button>
                        <button className="table-action" type="button" aria-label={text("removeWorkflowStep")}
                          disabled={saving || selected.steps.length <= 1}
                          onClick={() => updateWorkflow((workflow) => ({
                            ...workflow,
                            steps: workflow.steps.filter((_, stepIndex) => stepIndex !== index),
                          }))}>×</button>
                      </div>
                    </div>
                    <div className="workflow-step-fields">
                      <label>
                        {text("name")}
                        <input required maxLength={120} value={step.label} disabled={saving}
                          onChange={(event) => updateStep(index, (current) => ({ ...current, label: event.target.value }))} />
                      </label>
                      <label>
                        {text("approverRole")}
                        <select value={step.approver_role_id ?? ""} disabled={saving} onChange={(event) => updateStep(index, (current) => ({
                          ...current,
                          approver_role_id: event.target.value || null,
                          approver_user_id: event.target.value ? null : current.approver_user_id,
                        }))}>
                          <option value="">—</option>
                          {data.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                        </select>
                      </label>
                      <label>
                        {text("approverUser")}
                        <select value={step.approver_user_id ?? ""} disabled={saving} onChange={(event) => updateStep(index, (current) => ({
                          ...current,
                          approver_user_id: event.target.value || null,
                          approver_role_id: event.target.value ? null : current.approver_role_id,
                        }))}>
                          <option value="">—</option>
                          {data.users.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}
                        </select>
                      </label>
                      <label>
                        {text("workflowThreshold")}
                        <input type="number" min="0" step="0.01" disabled={saving}
                          placeholder={text("workflowAlwaysRequired")}
                          value={step.min_amount_usd ?? ""}
                          onChange={(event) => updateStep(index, (current) => ({
                            ...current,
                            min_amount_usd: event.target.value || null,
                          }))} />
                      </label>
                    </div>
                  </article>
                ))}
              </div>
              {isDirty && <p className="muted" role="status">{text("unsavedChanges")}</p>}
              <div className="workflow-actions">
                <button className="button button-secondary" type="button" onClick={() => updateWorkflow((workflow) => ({
                  ...workflow,
                  steps: [...workflow.steps, {
                    label: "",
                    approver_role_id: null,
                    approver_user_id: null,
                    min_amount_usd: null,
                  }],
                }))} disabled={saving || selected.steps.length >= 20}>
                  {text("addWorkflowStep")}
                </button>
                <button className="button button-primary" type="button" onClick={() => void saveWorkflow()}
                  disabled={saving || !isDirty || selected.steps.some((step) =>
                    !step.label.trim() || (!!step.approver_role_id === !!step.approver_user_id)
                    || (step.min_amount_usd !== null && !/^\d{1,16}(?:\.\d{1,2})?$/.test(step.min_amount_usd)))}>
                  {saving ? text("saving") : text("saveChanges")}
                </button>
              </div>
            </div>
          )}
        </>
      ) : <p className="empty-state">{text("noApprovalWorkflows")}</p>}
    </section>
  );
}
