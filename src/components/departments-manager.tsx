"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface Department {
  id: string;
  code: string;
  name: string;
  color: string | null;
  is_active: boolean;
  head_user_id: string | null;
  head_name: string | null;
}

interface UserChoice { id: string; full_name: string; is_active: boolean }

export function DepartmentsManager({ locale }: { locale: Locale }) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<UserChoice[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#1F3A5F");
  const [newHeadUserId, setNewHeadUserId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirtyDepartmentId, setDirtyDepartmentId] = useState("");
  const selected = departments.find((department) => department.id === selectedId);

  const load = useCallback(async (preferredId?: string) => {
    setLoading(true);
    try {
      const departmentResponse = await fetch("/api/v1/departments");
      const departmentData = await departmentResponse.json() as { departments: Department[]; users: UserChoice[]; error?: string };
      if (!departmentResponse.ok) throw new Error(departmentData.error ?? text("requestFailed"));
      setDepartments(departmentData.departments);
      setUsers(departmentData.users);
      setSelectedId((current) => preferredId && departmentData.departments.some((department) => department.id === preferredId)
        ? preferredId
        : departmentData.departments.some((department) => department.id === current)
          ? current
          : departmentData.departments[0]?.id ?? "");
    } finally {
      setLoading(false);
    }
  }, [text]);

  useEffect(() => {
    load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : text("requestFailed")))
      .finally(() => setLoading(false));
  }, [load, text]);

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch("/api/v1/departments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: newCode.trim().toUpperCase(), name: newName, color: newColor, headUserId: newHeadUserId || null }),
      });
      const data = await response.json() as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? text("requestFailed"));
      setNewCode("");
      setNewName("");
      setNewHeadUserId("");
      setNotice(text("departmentCreated"));
      await load(data.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function saveDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch(`/api/v1/departments/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: String(form.get("code") ?? "").trim().toUpperCase(),
          name: form.get("name"),
          color: form.get("color") || null,
          headUserId: form.get("headUserId") || null,
          isActive: form.get("isActive") === "true",
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? text("requestFailed"));
      setDirtyDepartmentId("");
      setNotice(text("departmentSaved"));
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  return <div className="departments-layout">
    {error && <p className="form-error admin-feedback" role="alert">{error}</p>}
    {notice && <p className="success-message admin-feedback" role="status">{notice}</p>}
    <section className="panel department-list-panel">
      <div className="panel-heading"><div><span className="eyebrow">{text("departments").toUpperCase()}</span><h2>{text("directionsList")}</h2></div><span className="count-pill">{departments.length}</span></div>
      {loading ? <p className="muted">{text("loading")}</p> : departments.map((department) => <button type="button" key={department.id}
        disabled={saving} className={`department-select ${department.id === selectedId ? "selected" : ""}`} onClick={() => {
          if (department.id === selectedId) return;
          if (dirtyDepartmentId === selectedId && !window.confirm(text("discardDepartmentChanges"))) return;
          setDirtyDepartmentId("");
          setSelectedId(department.id);
        }}>
        <span className="department-avatar" style={{ background: department.color ?? undefined }}>{department.name.slice(0, 1).toUpperCase()}</span>
        <span><strong>{department.name}</strong><small>{department.code} · {department.head_name ?? text("noDepartmentHead")}</small></span>
      </button>)}
    </section>
    <div className="departments-forms">
      {selected && <form key={selected.id} className="panel stack-form" onChange={() => setDirtyDepartmentId(selected.id)} onSubmit={saveDepartment}>
        <div className="panel-heading"><div><span className="eyebrow">{text("department").toUpperCase()}</span><h2>{selected.name}</h2></div></div>
        <fieldset className="department-fields" disabled={saving}>
        <label>{text("departmentCode")}<input name="code" required minLength={2} maxLength={20} pattern="[A-Za-z0-9_-]+" defaultValue={selected.code} /></label>
        <label>{text("name")}<input name="name" required minLength={2} maxLength={120} defaultValue={selected.name} /></label>
        <label>{text("departmentColor")}<input name="color" type="color" defaultValue={selected.color ?? "#1F3A5F"} /></label>
        <label>{text("departmentHead")}<select name="headUserId" defaultValue={selected.head_user_id ?? ""}>
          <option value="">{text("noDepartmentHead")}</option>
          {users.filter((user) => user.is_active || user.id === selected.head_user_id).map((user) => (
            <option key={user.id} value={user.id}>{user.full_name}{user.is_active ? "" : ` · ${text("inactive")}`}</option>
          ))}
        </select></label>
        <label>{text("state")}<select name="isActive" defaultValue={String(selected.is_active)}>
          <option value="true">{text("active")}</option><option value="false">{text("inactive")}</option>
        </select></label>
        </fieldset>
        {dirtyDepartmentId === selected.id && <p className="muted" role="status">{text("unsavedChanges")}</p>}
        <button className="button button-primary department-save-button" disabled={saving || loading}>{saving ? text("saving") : text("saveChanges")}</button>
      </form>}
      <form className="panel stack-form" onSubmit={createDepartment}>
        <div className="panel-heading"><div><span className="eyebrow">{text("newAccess").toUpperCase()}</span><h2>{text("createDepartment")}</h2></div></div>
        <fieldset className="department-fields" disabled={saving || loading}>
        <label>{text("departmentCode")}<input value={newCode} onChange={(event) => setNewCode(event.target.value.toUpperCase())} required minLength={2} maxLength={20} pattern="[A-Z0-9_-]+" /></label>
        <label>{text("name")}<input value={newName} onChange={(event) => setNewName(event.target.value)} required minLength={2} maxLength={120} /></label>
        <label>{text("departmentColor")}<input type="color" value={newColor} onChange={(event) => setNewColor(event.target.value)} /></label>
        <label>{text("departmentHead")}<select value={newHeadUserId} onChange={(event) => setNewHeadUserId(event.target.value)}>
          <option value="">{text("noDepartmentHead")}</option>
          {users.filter((user) => user.is_active).map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}
        </select></label>
        </fieldset>
        <button className="button button-primary department-save-button" disabled={saving || loading}>{saving ? text("saving") : text("createDepartment")}</button>
      </form>
    </div>
  </div>;
}
