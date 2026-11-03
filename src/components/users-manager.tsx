"use client";

import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  department_id: string | null;
  department: string | null;
  role_assignments: RoleAssignment[];
}

interface Choice { id: string; name: string }
interface DepartmentChoice extends Choice { is_active: boolean }
interface RoleChoice { code: string; name: string }
interface RoleAssignment { roleCode: string; entityId: string | null; entityName?: string | null }
interface RegistrationRequest {
  id: string;
  full_name: string;
  email: string;
  status: string;
  department: string;
  badge_id: string;
}
interface AuthorizedBadge {
  id: string;
  badge_id: string;
  full_name: string;
  job_title: string | null;
  department: string;
  is_active: boolean;
}

export function UsersManager({ locale }: { locale: Locale }) {
  const text = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentChoice[]>([]);
  const [roles, setRoles] = useState<RoleChoice[]>([]);
  const [entities, setEntities] = useState<Choice[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [creatingUser, setCreatingUser] = useState(false);
  const [savingUserId, setSavingUserId] = useState("");
  const [savingRoles, setSavingRoles] = useState(false);
  const [approvingRegistrationId, setApprovingRegistrationId] = useState("");
  const [registeringBadge, setRegisteringBadge] = useState(false);
  const [savingBadgeId, setSavingBadgeId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editDepartmentId, setEditDepartmentId] = useState("");
  const [editAssignments, setEditAssignments] = useState<RoleAssignment[]>([]);
  const [newAssignments, setNewAssignments] = useState<RoleAssignment[]>([]);
  const [resetLink, setResetLink] = useState("");
  const [resetLinkUserId, setResetLinkUserId] = useState("");
  const [generatingResetLink, setGeneratingResetLink] = useState("");
  const [registrationRequests, setRegistrationRequests] = useState<RegistrationRequest[]>([]);
  const [authorizedBadges, setAuthorizedBadges] = useState<AuthorizedBadge[]>([]);
  const [registrationRoleById, setRegistrationRoleById] = useState<Record<string, string>>({});
  const [userSearch, setUserSearch] = useState("");
  const [userStatus, setUserStatus] = useState<"all" | "active" | "inactive">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/users");
      const data = await response.json() as { users: UserRow[]; departments: DepartmentChoice[]; roles: RoleChoice[]; entities: Choice[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? translate(locale, "requestFailed"));
      setUsers(data.users);
      setDepartments(data.departments);
      setRoles(data.roles);
      setEntities(data.entities);
      const registrationResponse = await fetch("/api/v1/registration/admin");
      const registrationData = await registrationResponse.json() as {
        requests?: RegistrationRequest[];
        badges?: AuthorizedBadge[];
        roles?: RoleChoice[];
        error?: string;
      };
      if (!registrationResponse.ok) throw new Error(registrationData.error ?? translate(locale, "requestFailed"));
      setRegistrationRequests(registrationData.requests ?? []);
      setAuthorizedBadges(registrationData.badges ?? []);
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
    setCreatingUser(true);
    try {
      const form = new FormData(formElement);
      const response = await fetch("/api/v1/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: form.get("fullName"),
          email: form.get("email"),
          password: form.get("password"),
          departmentId: form.get("departmentId") || null,
          roleAssignments: newAssignments.map(({ roleCode, entityId }) => ({ roleCode, entityId })),
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? text("invalidUser"));
      formElement.reset();
      setNewAssignments([]);
      setNotice(text("userCreated"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setCreatingUser(false);
    }
  }

  async function toggleActive(user: UserRow) {
    setError("");
    setNotice("");
    setSavingUserId(user.id);
    try {
      const response = await fetch(`/api/v1/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !user.is_active }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? text("requestFailed"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSavingUserId("");
    }
  }

  async function saveRoles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    setError("");
    setNotice("");
    setSavingRoles(true);
    try {
      const response = await fetch(`/api/v1/users/${editingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roleAssignments: editAssignments.map(({ roleCode, entityId }) => ({ roleCode, entityId })),
          departmentId: editDepartmentId || null,
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? text("requestFailed"));
      setEditingId("");
      setEditDepartmentId("");
      setNotice(text("userAccessSaved"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSavingRoles(false);
    }
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

  async function approveRegistration(registrationId: string, roleCode: string) {
    setError("");
    setNotice("");
    setApprovingRegistrationId(registrationId);
    try {
      const response = await fetch("/api/v1/registration/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: registrationId, roleCodes: [roleCode] }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? text("requestFailed"));
      setNotice(text("registrationApproved"));
      setRegistrationRoleById((current) => {
        const next = { ...current };
        delete next[registrationId];
        return next;
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setApprovingRegistrationId("");
    }
  }

  async function addBadge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setRegisteringBadge(true);
    const formElement = event.currentTarget;
    try {
      const form = new FormData(formElement);
      const response = await fetch("/api/v1/registration/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          badgeId: form.get("badgeId"),
          fullName: form.get("badgeFullName"),
          jobTitle: form.get("jobTitle") || null,
          departmentId: form.get("badgeDepartmentId"),
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? text("requestFailed"));
      formElement.reset();
      setNotice(text("badgeAuthorized"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setRegisteringBadge(false);
    }
  }

  async function toggleBadge(badge: AuthorizedBadge) {
    setError("");
    setNotice("");
    setSavingBadgeId(badge.id);
    try {
      const response = await fetch(`/api/v1/registration/admin/badges/${badge.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !badge.is_active }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? text("requestFailed"));
      setNotice(text(badge.is_active ? "badgeDeactivated" : "badgeActivated"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSavingBadgeId("");
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

  function assignmentOptions(selected: RoleAssignment[], onChange: (value: RoleAssignment[]) => void, disabled = false) {
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
            <input type="checkbox" checked={checked} disabled={disabled}
              onChange={() => onChange(toggleAssignment(selected, assignment))} />
            {role?.name} — {label}
          </label>;
        })}
      </div>
    );
  }

  const filteredUsers = users.filter((user) => {
    const query = userSearch.trim().toLocaleLowerCase();
    const matchesQuery = !query || [
      user.full_name,
      user.email,
      user.department ?? "",
      ...user.role_assignments.map(({ roleCode, entityName }) => `${roleCode} ${entityName ?? ""}`),
    ].some((value) => value.toLocaleLowerCase().includes(query));
    const matchesStatus = userStatus === "all" || user.is_active === (userStatus === "active");
    return matchesQuery && matchesStatus;
  });
  const isMutationBusy = Boolean(
    creatingUser || savingUserId || savingRoles || approvingRegistrationId
    || registeringBadge || generatingResetLink || savingBadgeId,
  );
  const editingUser = users.find((user) => user.id === editingId);
  const normalizedEditAssignments = [...editAssignments]
    .map(({ roleCode, entityId }) => ({ roleCode, entityId }))
    .sort((left, right) => `${left.roleCode}:${left.entityId ?? ""}`.localeCompare(`${right.roleCode}:${right.entityId ?? ""}`));
  const normalizedSavedAssignments = [...(editingUser?.role_assignments ?? [])]
    .map(({ roleCode, entityId }) => ({ roleCode, entityId }))
    .sort((left, right) => `${left.roleCode}:${left.entityId ?? ""}`.localeCompare(`${right.roleCode}:${right.entityId ?? ""}`));
  const userAccessDirty = Boolean(editingUser && (
    editDepartmentId !== (editingUser.department_id ?? "")
    || JSON.stringify(normalizedEditAssignments) !== JSON.stringify(normalizedSavedAssignments)
  ));
  const pendingRegistrations = registrationRequests.filter((item) => item.status === "pending_approval").length;
  const activeUsers = users.filter((user) => user.is_active).length;

  return (
    <div className="users-admin-shell">
      {error && <p className="form-error admin-feedback" role="alert">{error}</p>}
      {notice && <p className="success-message admin-feedback" role="status">{notice}</p>}
      <section className="users-overview" aria-label={text("users")}>
        <article className="users-overview-card users-overview-primary">
          <span>{text("usersEyebrow")}</span>
          <strong>{loading ? "—" : users.length}</strong>
          <small>{text("users")}</small>
        </article>
        <article className="users-overview-card">
          <span>{text("active")}</span>
          <strong>{loading ? "—" : activeUsers}</strong>
          <small>{text("activeUsers")}</small>
        </article>
        <article className="users-overview-card">
          <span>{text("registrations")}</span>
          <strong>{loading ? "—" : pendingRegistrations}</strong>
          <small>{text("pendingRegistrations")}</small>
        </article>
      </section>
      <div className="users-admin-layout">
      <section className="panel admin-list-panel users-directory-panel">
        <div className="panel-heading"><div><span className="eyebrow">{text("usersEyebrow").toUpperCase()}</span><h2>{text("users")}</h2></div><span className="count-pill">{users.length}</span></div>
        {loading ? <p className="muted">{text("loading")}</p> : (
          <>
          <div className="user-list-toolbar">
            <label className="user-search"><span className="sr-only">{text("searchUsers")}</span>
              <input type="search" value={userSearch} placeholder={text("searchUsers")}
                onChange={(event) => setUserSearch(event.target.value)} />
            </label>
            <label className="user-status-filter"><span className="sr-only">{text("state")}</span>
              <select value={userStatus} onChange={(event) => setUserStatus(event.target.value as typeof userStatus)}>
                <option value="all">{text("allUsers")}</option>
                <option value="active">{text("active")}</option>
                <option value="inactive">{text("inactive")}</option>
              </select>
            </label>
          </div>
          <div className="table-scroll"><table><thead><tr><th scope="col">{text("name")}</th><th scope="col">{text("department")}</th><th scope="col">{text("role")}</th><th scope="col">{text("state")}</th><th scope="col">{text("actions")}</th></tr></thead>
            <tbody>{filteredUsers.map((user) => <Fragment key={user.id}>
              <tr><td><strong>{user.full_name}</strong><small className="table-sub">{user.email}</small></td>
                <td>{user.department ?? "—"}</td><td><div className="tag-list">{user.role_assignments.map((assignment) => <span className="tag" key={`${assignment.roleCode}:${assignment.entityId ?? "global"}`}>{assignment.roleCode}{assignment.entityName ? ` · ${assignment.entityName}` : ""}</span>)}</div></td>
                <td><span className={`status-pill ${user.is_active ? "status-active" : "status-inactive"}`}>{user.is_active ? text("active") : text("inactive")}</span></td>
                <td className="user-actions">
                  <button type="button" className="table-action" disabled={isMutationBusy} onClick={() => void toggleActive(user)}>{savingUserId === user.id ? text("saving") : user.is_active ? text("deactivate") : text("activate")}</button>
                  <button type="button" className="table-action" disabled={isMutationBusy} onClick={() => {
                    if (editingId && editingId !== user.id && userAccessDirty && !window.confirm(text("discardUserAccessChanges"))) return;
                    setEditingId(user.id);
                    setEditDepartmentId(user.department_id ?? "");
                    setEditAssignments(user.role_assignments.map(({ roleCode, entityId, entityName }) => ({ roleCode, entityId, entityName })));
                  }}>{text("editAccess")}</button>
                  {user.is_active && <button type="button" className="table-action" disabled={isMutationBusy} onClick={() => void generateResetLink(user)}>{generatingResetLink === user.id ? text("saving") : text("generateResetLink")}</button>}
                </td>
              </tr>
              {editingId === user.id && <tr><td colSpan={5}><form className="inline-role-form" onSubmit={saveRoles}>
                <label className="user-department-edit">{text("department")}
                  <select value={editDepartmentId} disabled={savingRoles} onChange={(event) => setEditDepartmentId(event.target.value)}>
                    <option value="">{text("noDepartment")}</option>
                    {departments.filter((department) => department.is_active || department.id === user.department_id).map((department) => (
                      <option key={department.id} value={department.id}>{department.name}{department.is_active ? "" : ` · ${text("inactive")}`}</option>
                    ))}
                  </select>
                </label>
                {assignmentOptions(editAssignments, setEditAssignments, savingRoles)}
                <div className="inline-role-actions">
                  {userAccessDirty && <span className="muted">{text("unsavedChanges")}</span>}
                  <button className="button button-primary" type="submit" disabled={savingRoles || !userAccessDirty || editAssignments.length === 0}>{savingRoles ? text("saving") : text("save")}</button>
                  <button className="button button-secondary" type="button" disabled={savingRoles} onClick={() => {
                    if (userAccessDirty && !window.confirm(text("discardUserAccessChanges"))) return;
                    setEditingId("");
                    setEditDepartmentId("");
                  }}>{text("cancel")}</button>
                </div>
              </form></td></tr>}
            </Fragment>)}</tbody>
          </table>
          {!filteredUsers.length && <p className="empty-state">{userSearch || userStatus !== "all" ? text("noUsersMatch") : text("noUsers")}</p>}
          </div>
          </>
        )}
        {resetLink && resetLinkUserId && <div className="admin-reset-link" role="status">
          <strong>{text("adminResetLinkReady")}</strong>
          <a href={resetLink} target="_blank" rel="noreferrer">{resetLink}</a>
          <small>{text("resetLinkExpiry")}</small>
        </div>}
      </section>
      <aside className="users-admin-sidebar">
        <section className="panel create-user-panel">
          <div className="panel-heading"><div><span className="eyebrow">{text("newAccess").toUpperCase()}</span><h2>{text("createUser")}</h2></div><span className="plus-mark" aria-hidden="true">＋</span></div>
          <form className="stack-form" onSubmit={createUser}>
            <fieldset disabled={isMutationBusy || loading}>
              <label>{text("fullName")}<input name="fullName" required minLength={2} maxLength={160} /></label>
              <label>{text("emailAddress")}<input name="email" type="email" required maxLength={254} /></label>
              <label>{text("initialPassword")}<input name="password" type="password" required minLength={12} maxLength={128} /><small>{text("passwordMinimum")}</small></label>
              <label>{text("department")}<select name="departmentId" defaultValue=""><option value="">{text("noDepartment")}</option>{departments.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <fieldset><legend>{text("role")}</legend>{assignmentOptions(newAssignments, setNewAssignments)}</fieldset>
            </fieldset>
            <button className="button button-primary" type="submit" disabled={isMutationBusy || loading || newAssignments.length === 0}>{creatingUser ? text("saving") : text("createAccount")} <span aria-hidden="true">→</span></button>
          </form>
        </section>
      </aside>
      <section className="panel registration-panel users-registration-panel">
        <div className="panel-heading"><div><span className="eyebrow">{text("registrations").toUpperCase()}</span><h2>{text("registrations")}</h2></div><span className="count-pill">{registrationRequests.filter((item) => item.status === "pending_approval").length}</span></div>
        <div className="registration-requests">
          {registrationRequests.filter((item) => item.status === "pending_approval").map((item) => (
            <div className="pending-registration" key={item.id}>
              <strong>{item.full_name}</strong>
              <small>{item.email} · {item.department} · {item.badge_id}</small>
              <select aria-label={text("roleToAssign")} disabled={isMutationBusy} value={registrationRoleById[item.id] ?? ""}
                onChange={(event) => setRegistrationRoleById((current) => ({ ...current, [item.id]: event.target.value }))}>
                <option value="">{text("selectRole")}</option>
                {roles.map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}
              </select>
              <button type="button" className="button button-secondary"
                disabled={!registrationRoleById[item.id] || isMutationBusy}
                onClick={() => void approveRegistration(item.id, registrationRoleById[item.id] ?? "")}>
                {approvingRegistrationId === item.id ? text("saving") : text("approve")}
              </button>
            </div>
          ))}
          {!registrationRequests.some((item) => item.status === "pending_approval") && <p className="muted">{text("noPendingRegistrations")}</p>}
        </div>
        <section className="badge-admin-section">
          <div className="panel-heading"><div><span className="eyebrow">{text("authorizedBadges").toUpperCase()}</span><h2>{text("authorizedBadges")}</h2></div><span className="count-pill">{authorizedBadges.length}</span></div>
          <div className="badge-admin-layout">
          <div className="badge-list" aria-label={text("authorizedBadges")}>
            {authorizedBadges.map((badge) => (
              <article className="badge-row" key={badge.id}>
                <div>
                  <strong>{badge.badge_id}</strong>
                  <small>{badge.full_name} · {badge.department}{badge.job_title ? ` · ${badge.job_title}` : ""}</small>
                </div>
                <span className={`status-pill ${badge.is_active ? "status-active" : "status-inactive"}`}>
                  {badge.is_active ? text("active") : text("inactive")}
                </span>
                <button type="button" className="table-action" disabled={isMutationBusy}
                  onClick={() => void toggleBadge(badge)}>
                  {savingBadgeId === badge.id ? text("saving") : text(badge.is_active ? "deactivateBadge" : "activateBadge")}
                </button>
              </article>
            ))}
            {!authorizedBadges.length && <p className="muted">{text("noAuthorizedBadges")}</p>}
          </div>
          <form className="stack-form badge-create-form" onSubmit={addBadge}>
            <div className="badge-form-heading"><strong>{text("authorizeBadge")}</strong><span>{text("authorizedBadges")}</span></div>
            <div className="badge-form-fields">
              <label>{text("fullName")}<input name="badgeFullName" required minLength={2} maxLength={160} /></label>
              <label>{text("badgeId")}<input name="badgeId" required pattern="[A-Za-z]{3}-[A-Za-z]{3}-[0-9]{8}" placeholder="MJP-DMC-00981028" /></label>
              <label>{text("jobTitle")}<input name="jobTitle" maxLength={160} /></label>
              <label>{text("department")}<select name="badgeDepartmentId" required defaultValue=""><option value="" disabled>{text("selectDepartment")}</option>{departments.filter((department) => department.is_active).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
            </div>
            <button className="button button-primary" type="submit" disabled={isMutationBusy || loading}>{registeringBadge ? text("saving") : text("authorizeBadge")}</button>
          </form>
          </div>
        </section>
      </section>
      </div>
    </div>
  );
}
