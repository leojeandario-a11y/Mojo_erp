"use client";

import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  department: string | null;
  role_assignments: RoleAssignment[];
}

interface Choice { id: string; name: string }
interface RoleChoice { code: string; name: string }
interface RoleAssignment { roleCode: string; entityId: string | null; entityName?: string | null }

export function UsersManager({ locale }: { locale: Locale }) {
  const text = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<Choice[]>([]);
  const [roles, setRoles] = useState<RoleChoice[]>([]);
  const [entities, setEntities] = useState<Choice[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState("");
  const [editAssignments, setEditAssignments] = useState<RoleAssignment[]>([]);
  const [newAssignments, setNewAssignments] = useState<RoleAssignment[]>([]);
  const [resetLink, setResetLink] = useState("");
  const [resetLinkUserId, setResetLinkUserId] = useState("");
  const [generatingResetLink, setGeneratingResetLink] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/users");
      const data = await response.json();
      if (!response.ok) throw new Error(translate(locale, "requestFailed"));
      setUsers(data.users);
      setDepartments(data.departments);
      setRoles(data.roles);
      setEntities(data.entities);
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    load().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : translate(locale, "requestFailed"));
      setLoading(false);
    });
  }, [load, locale]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    setNotice("");
    const form = new FormData(formElement);
    const response = await fetch("/api/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: form.get("fullName"),
        email: form.get("email"),
        password: form.get("password"),
        departmentId: form.get("departmentId") || null,
        roleAssignments: newAssignments,
      }),
    });
    if (!response.ok) {
      setError(text("invalidUser"));
      return;
    }
    formElement.reset();
    setNewAssignments([]);
    setNotice(text("userCreated"));
    await load();
  }

  async function toggleActive(user: UserRow) {
    setError("");
    const response = await fetch(`/api/v1/users/${user.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !user.is_active }),
    });
    if (!response.ok) {
      setError(text("requestFailed"));
      return;
    }
    await load();
  }

  async function saveRoles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    const response = await fetch(`/api/v1/users/${editingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roleAssignments: editAssignments.map(({ roleCode, entityId }) => ({ roleCode, entityId })) }),
    });
    if (!response.ok) {
      setError(text("requestFailed"));
      return;
    }
    setEditingId("");
    setNotice(text("roleSaved"));
    await load();
  }

  async function generateResetLink(user: UserRow) {
    setError("");
    setNotice("");
    setResetLink("");
    setGeneratingResetLink(user.id);
    try {
      const response = await fetch(`/api/v1/users/${user.id}/password-reset-link`, { method: "POST" });
      const data = await response.json() as { url?: string };
      if (!response.ok || !data.url) throw new Error(text("requestFailed"));
      setResetLink(data.url);
      setResetLinkUserId(user.id);
      setNotice(text("adminResetLinkReady"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setGeneratingResetLink("");
    }
  }

  function toggleAssignment(
    current: RoleAssignment[],
    assignment: RoleAssignment,
  ): RoleAssignment[] {
    const exists = current.some((item) => item.roleCode === assignment.roleCode && item.entityId === assignment.entityId);
    return exists
      ? current.filter((item) => item.roleCode !== assignment.roleCode || item.entityId !== assignment.entityId)
      : [...current, assignment];
  }

  function assignmentOptions(selected: RoleAssignment[], onChange: (value: RoleAssignment[]) => void) {
    return (
      <div className="role-options">
        {roles.flatMap((role) => [
          { roleCode: role.code, entityId: null, entityName: null },
          ...(role.code === "super_admin" ? [] : entities.map((entity) => (
            { roleCode: role.code, entityId: entity.id, entityName: entity.name }
          ))),
        ]).map((assignment) => {
          const role = roles.find((item) => item.code === assignment.roleCode);
          const label = assignment.entityName ?? text("allEntities");
          const checked = selected.some((item) =>
            item.roleCode === assignment.roleCode && item.entityId === assignment.entityId,
          );
          return <label key={`${assignment.roleCode}:${assignment.entityId ?? "global"}`} className="checkbox-option">
            <input type="checkbox" checked={checked}
              onChange={() => onChange(toggleAssignment(selected, assignment))} />
            {role?.name} — {label}
          </label>;
        })}
      </div>
    );
  }

  return (
    <div className="admin-grid">
      <section className="panel admin-list-panel">
        <div className="panel-heading"><div><span className="eyebrow">{text("usersEyebrow").toUpperCase()}</span><h2>{text("users")}</h2></div><span className="count-pill">{users.length}</span></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? <p className="muted">{text("loading")}</p> : (
          <div className="table-scroll"><table><thead><tr><th>{text("name")}</th><th>{text("department")}</th><th>{text("role")}</th><th>{text("state")}</th><th /></tr></thead>
            <tbody>{users.map((user) => <Fragment key={user.id}>
              <tr><td><strong>{user.full_name}</strong><small className="table-sub">{user.email}</small></td>
                <td>{user.department ?? "—"}</td><td><div className="tag-list">{user.role_assignments.map((assignment) => <span className="tag" key={`${assignment.roleCode}:${assignment.entityId ?? "global"}`}>{assignment.roleCode}{assignment.entityName ? ` · ${assignment.entityName}` : ""}</span>)}</div></td>
                <td><span className={`status-pill ${user.is_active ? "status-active" : "status-inactive"}`}>{user.is_active ? text("active") : text("inactive")}</span></td>
                <td className="user-actions">
                  <button type="button" className="table-action" onClick={() => void toggleActive(user)}>{user.is_active ? text("deactivate") : text("activate")}</button>
                  <button type="button" className="table-action" onClick={() => { setEditingId(user.id); setEditAssignments(user.role_assignments.map(({ roleCode, entityId, entityName }) => ({ roleCode, entityId, entityName }))); }}>{text("editRoles")}</button>
                  {user.is_active && <button type="button" className="table-action" disabled={generatingResetLink === user.id} onClick={() => void generateResetLink(user)}>{generatingResetLink === user.id ? text("saving") : text("generateResetLink")}</button>}
                </td>
              </tr>
              {editingId === user.id && <tr><td colSpan={5}><form className="inline-role-form" onSubmit={saveRoles}>
                {assignmentOptions(editAssignments, setEditAssignments)}
                <div className="inline-role-actions"><button className="button button-primary" type="submit">{text("save")}</button><button className="button button-secondary" type="button" onClick={() => setEditingId("")}>{text("cancel")}</button></div>
              </form></td></tr>}
            </Fragment>)}</tbody>
          </table></div>
        )}
        {resetLink && resetLinkUserId && <div className="admin-reset-link" role="status">
          <strong>{text("adminResetLinkReady")}</strong>
          <a href={resetLink} target="_blank" rel="noreferrer">{resetLink}</a>
          <small>{text("resetLinkExpiry")}</small>
        </div>}
      </section>
      <section className="panel create-user-panel">
        <div className="panel-heading"><div><span className="eyebrow">{text("newAccess").toUpperCase()}</span><h2>{text("createUser")}</h2></div><span className="plus-mark">＋</span></div>
        <form className="stack-form" onSubmit={createUser}>
          <label>{text("fullName")}<input name="fullName" required minLength={2} maxLength={160} /></label>
          <label>{text("emailAddress")}<input name="email" type="email" required maxLength={254} /></label>
          <label>{text("initialPassword")}<input name="password" type="password" required minLength={12} maxLength={128} /><small>{text("passwordMinimum")}</small></label>
          <label>{text("department")}<select name="departmentId" defaultValue=""><option value="">{text("noDepartment")}</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <fieldset><legend>{text("role")}</legend>{assignmentOptions(newAssignments, setNewAssignments)}</fieldset>
          {notice && <p className="success-message" role="status">{notice}</p>}
          <button className="button button-primary" type="submit">{text("createAccount")} <span aria-hidden="true">→</span></button>
        </form>
      </section>
    </div>
  );
}
