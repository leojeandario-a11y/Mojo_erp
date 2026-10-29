"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface Role { id: string; code: string; name: string; description: string | null; is_system: boolean; permissions: string[] }
interface Permission { code: string; module: string }

export function RolesManager({ locale }: { locale: Locale }) {
  const text = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/roles");
      const data = await response.json();
      if (!response.ok) throw new Error(translate(locale, "requestFailed"));
      setRoles(data.roles);
      setPermissions(data.permissions);
      const initial = data.roles[0] as Role | undefined;
      if (initial) {
        setSelectedId((current) => current || initial.id);
        setName((current) => current || initial.name);
        setDescription((current) => current || initial.description || "");
        setSelectedPermissions((current) => current.length ? current : initial.permissions);
      }
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : translate(locale, "requestFailed")));
  }, [load, locale]);

  function chooseRole(role: Role, updateId = true) {
    if (updateId) setSelectedId(role.id);
    else setSelectedId((current) => current || role.id);
    setName(role.name);
    setDescription(role.description ?? "");
    setSelectedPermissions(role.permissions);
  }

  const selectedRole = roles.find((role) => role.id === selectedId);
  const grouped = useMemo(() => permissions.reduce<Record<string, Permission[]>>((result, item) => {
    (result[item.module] ??= []).push(item);
    return result;
  }, {}), [permissions]);

  function togglePermission(code: string) {
    setSelectedPermissions((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRole) return;
    setError("");
    setNotice("");
    const response = await fetch(`/api/v1/roles/${selectedRole.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description: description || null, permissions: selectedPermissions }),
    });
    if (!response.ok) {
      setError(text("requestFailed"));
      return;
    }
    setNotice(text("roleSaved"));
    setRoles((current) => current.map((role) => role.id === selectedRole.id
      ? { ...role, name, description: description || null, permissions: selectedPermissions }
      : role));
    await load();
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const response = await fetch("/api/v1/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName, description: newDescription || null, permissions: [] }),
    });
    if (!response.ok) {
      setError(text("requestFailed"));
      return;
    }
    setNewName("");
    setNewDescription("");
    setCreating(false);
    setNotice(text("roleCreated"));
    await load();
  }

  return (
    <div className="roles-layout">
      <section className="panel roles-list">
        <div className="panel-heading"><div><span className="eyebrow">{text("roleAccess").toUpperCase()}</span><h2>{text("roles")}</h2></div><span className="count-pill">{roles.length}</span></div>
        <button type="button" className="button button-secondary" onClick={() => setCreating((current) => !current)}>{text("createRole")}</button>
        {creating && <form className="stack-form role-create-form" onSubmit={createRole}>
          <label>{text("name")}<input value={newName} onChange={(event) => setNewName(event.target.value)} required minLength={2} maxLength={120} /></label>
          <label>{text("roleDescription")}<input value={newDescription} onChange={(event) => setNewDescription(event.target.value)} maxLength={500} /></label>
          <button className="button button-primary" type="submit">{text("createRole")}</button>
        </form>}
        {loading ? <p className="muted">{text("loading")}</p> : roles.map((role) => <button key={role.id} className={`role-select ${role.id === selectedId ? "selected" : ""}`} onClick={() => chooseRole(role)}>
          <span className="role-avatar">{role.name.slice(0, 1).toUpperCase()}</span><span><strong>{role.name}</strong><small>{role.code}</small></span><span className="role-arrow">›</span>
        </button>)}
      </section>
      {selectedRole && <form className="panel role-editor" onSubmit={saveRole}>
        <div className="panel-heading"><div><span className="eyebrow">{text("roleConfiguration").toUpperCase()}</span><h2>{selectedRole.name}</h2></div>{selectedRole.is_system && <span className="tag">{text("systemRole")}</span>}</div>
        <div className="role-name-fields">
          <label>{text("name")}<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} disabled={selectedRole.code === "super_admin"} /></label>
          <label>{text("roleDescription")}<input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} disabled={selectedRole.code === "super_admin"} /></label>
        </div>
        <div className="permission-head"><div><h3>{text("assignedPermissions")}</h3><p>{text("permissionEffect")}</p></div><span className="count-pill">{selectedPermissions.length}</span></div>
        {selectedRole.code === "super_admin" && <p className="protected-note">{text("protectedAdmin")}</p>}
        <div className="permissions-grid">{Object.entries(grouped).map(([module, items]) => <div className="permission-group" key={module}>
          <div className="permission-module">{module}</div>
          {items.map((permission) => <label key={permission.code} className="permission-row">
            <span>{permission.code}</span>
            <input type="checkbox" checked={selectedPermissions.includes(permission.code)}
              disabled={selectedRole.code === "super_admin"}
              onChange={() => togglePermission(permission.code)} />
          </label>)}
        </div>)}</div>
        {notice && <p className="success-message" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="role-save-row"><span>{text("auditedChanges")}</span><button className="button button-primary" disabled={selectedRole.code === "super_admin"}>{text("saveChanges")} <span aria-hidden="true">→</span></button></div>
      </form>}
    </div>
  );
}
