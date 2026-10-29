"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface AuditEvent {
  id: string;
  occurred_at: string;
  user_id: string | null;
  actor_name: string | null;
  module: string | null;
  action: string;
  table_name: string | null;
  record_id: string | null;
  result: string;
  message: string | null;
}

interface AuditFilters {
  from: string;
  to: string;
  userId: string;
  module: string;
  action: string;
  result: string;
}

interface AuditFacets {
  users: Array<{ id: string; name: string | null }>;
  modules: string[];
  actions: string[];
}

const emptyFilters: AuditFilters = { from: "", to: "", userId: "", module: "", action: "", result: "" };

export function AuditViewer({ locale }: { locale: Locale }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>(emptyFilters);
  const [facets, setFacets] = useState<AuditFacets>({ users: [], modules: [], actions: [] });
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);

  const queryString = useCallback((pageOffset: number, selectedFilters: AuditFilters, format?: "csv") => {
    const params = new URLSearchParams();
    if (pageOffset) params.set("offset", String(pageOffset));
    for (const key of ["from", "to", "userId", "module", "action", "result"] as const) {
      if (selectedFilters[key]) params.set(key, selectedFilters[key]);
    }
    if (format) params.set("format", format);
    return params.toString();
  }, []);

  const loadPage = useCallback(async (pageOffset: number, selectedFilters: AuditFilters) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/audit?${queryString(pageOffset, selectedFilters)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(text("requestFailed"));
      setEvents(data.events);
      setOffset(pageOffset);
      setHasMore(data.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setLoading(false);
    }
  }, [queryString, text]);

  useEffect(() => {
    void loadPage(0, emptyFilters);
    fetch("/api/v1/audit?facets=1")
      .then(async (response) => {
        if (!response.ok) throw new Error(text("requestFailed"));
        const data = await response.json() as { facets: AuditFacets };
        setFacets(data.facets);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : text("requestFailed")));
  }, [loadPage, text]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters(filters);
    void loadPage(0, filters);
  }

  const exportHref = `/api/v1/audit?${queryString(0, appliedFilters, "csv")}`;

  return (
    <section className="panel audit-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">SYSTEM / AUDIT</span><h2>{text("audit")}</h2></div>
        <span className="count-pill">{events.length}</span>
      </div>
      <form className="audit-filters" onSubmit={applyFilters}>
        <label>{text("fromDate")}<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label>{text("toDate")}<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <label>{text("actor")}<select value={filters.userId} onChange={(event) => setFilters({ ...filters, userId: event.target.value })}>
          <option value="">{text("allUsers")}</option>{facets.users.map((user) => <option key={user.id} value={user.id}>{user.name ?? user.id}</option>)}
        </select></label>
        <label>{text("module")}<select value={filters.module} onChange={(event) => setFilters({ ...filters, module: event.target.value })}>
          <option value="">{text("allModules")}</option>{facets.modules.map((module) => <option key={module}>{module}</option>)}
        </select></label>
        <label>{text("action")}<select value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })}>
          <option value="">{text("allActions")}</option>{facets.actions.map((action) => <option key={action}>{action}</option>)}
        </select></label>
        <label>{text("result")}<select value={filters.result} onChange={(event) => setFilters({ ...filters, result: event.target.value })}>
          <option value="">{text("allResults")}</option><option value="success">{text("success")}</option><option value="denied">{text("denied")}</option>
        </select></label>
        <button className="button button-primary" type="submit">{text("applyFilters")}</button>
        <a className="button button-secondary" href={exportHref}>{text("exportCsv")}</a>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p className="muted">{text("loading")}</p> : (
        <div className="table-scroll">
          <table><thead><tr>
            <th>{text("occurredAt")}</th><th>{text("actor")}</th><th>{text("action")}</th>
            <th>{text("module")}</th><th>{text("record")}</th><th>{text("result")}</th><th>{text("details")}</th>
          </tr></thead>
            <tbody>{events.map((event) => <tr key={event.id}>
              <td>{new Intl.DateTimeFormat(locale === "ht" ? "ht-HT" : locale === "en" ? "en-US" : "fr-FR", {
                dateStyle: "medium", timeStyle: "short",
              }).format(new Date(event.occurred_at))}</td>
              <td>{event.actor_name ?? event.user_id ?? "—"}</td>
              <td><span className="tag">{event.action}</span></td>
              <td>{event.module ?? "—"}</td>
              <td>{event.table_name ? `${event.table_name}${event.record_id ? ` · ${event.record_id.slice(0, 8)}` : ""}` : "—"}</td>
              <td><span className={`status-pill ${event.result === "success" ? "status-active" : "status-inactive"}`}>
                {event.result === "success" ? text("success") : event.result === "denied" ? text("denied") : event.result}
              </span></td>
              <td className="audit-message">{event.message ?? "—"}</td>
            </tr>)}</tbody>
          </table>
          {!events.length && <p className="empty-state">{text("noAuditEvents")}</p>}
        </div>
      )}
      <div className="audit-pagination">
        <span>{events.length ? `${offset + 1}–${offset + events.length}` : "0"}</span>
        <div>
          <button className="button button-secondary" disabled={loading || offset === 0} onClick={() => void loadPage(Math.max(0, offset - 50), appliedFilters)}>{text("previous")}</button>
            <button className="button button-secondary" disabled={loading || !hasMore} onClick={() => void loadPage(offset + 50, appliedFilters)}>{text("next")}</button>
        </div>
      </div>
    </section>
  );
}
