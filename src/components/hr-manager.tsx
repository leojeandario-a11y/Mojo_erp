"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

interface Employee {
  id: string; employee_code: string; first_name: string; last_name: string;
  job_title: string | null; position_title?: string | null; department_name: string | null;
  hire_date: string; status: string; manager_name: string | null; contract_type: string | null;
}
interface LeaveType { id: string; name: string; days_per_year: string | null }
interface LeaveRequest { id: string; first_name: string; last_name: string; leave_type_name: string; start_date: string; end_date: string; days: string; status: string }
interface Evaluation { id: string; first_name: string; last_name: string; period_label: string; score: string; evaluated_on: string }
interface Attendance { id: string; first_name: string; last_name: string; work_date: string; status: string; minutes_late: number; note: string | null }
interface Balance { employee_id: string; first_name: string; last_name: string; leave_type_name: string; balance_year: number; carried_days: string; entitled_days: string; used_days: string }
interface HrDocument { id: string; title: string; file_name: string; mime_type: string; document_kind: string }
interface History { id: string; change_type: string; from_value: string | null; to_value: string | null; effective_date: string; note: string | null }

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null) as ({ error?: string } & T);
  if (!response.ok) throw new Error(body?.error || "La requête RH a échoué.");
  return body;
}

const statusLabels: Record<string, string> = {
  active: "Actif", on_leave: "En congé", suspended: "Suspendu", terminated: "Terminé",
  present: "Présent", absent: "Absent", late: "Retard", permission: "Permission", remote: "Télétravail",
  pending: "En attente", approved: "Approuvé", rejected: "Refusé", cancelled: "Annulé",
};

export function HrManager({ canManage, canManageAttendance }: { canManage: boolean; canManageAttendance: boolean }) {
  const [tab, setTab] = useState("people");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [documents, setDocuments] = useState<HrDocument[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [report, setReport] = useState<{ headcount: Array<{ status: string; count: number }>; attendanceThisMonth: Array<{ status: string; count: number }>; leaveThisYear: Array<{ status: string; count: number; days: string }> } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [employeeData, leaveData, evaluationData, attendanceData, reportData] = await Promise.all([
        api<{ employees: Employee[] }>("/api/v1/hr/employees"),
        api<{ types: LeaveType[]; requests: LeaveRequest[]; balances: Balance[] }>("/api/v1/hr/leaves"),
        api<{ evaluations: Evaluation[] }>("/api/v1/hr/evaluations"),
        api<{ records: Attendance[] }>("/api/v1/hr/attendance"),
        api<typeof report>("/api/v1/hr/reports"),
      ]);
      setEmployees(employeeData.employees);
      setTypes(leaveData.types);
      setLeaves(leaveData.requests);
      setBalances(leaveData.balances);
      setEvaluations(evaluationData.evaluations);
      setAttendance(attendanceData.records);
      setReport(reportData);
      setSelectedEmployee((current) => current || employeeData.employees[0]?.id || "");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de charger le module RH.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selectedEmployee) return;
    void Promise.all([
      api<{ documents: HrDocument[] }>(`/api/v1/hr/employees/${selectedEmployee}/documents`),
      api<{ history: History[] }>(`/api/v1/hr/employees/${selectedEmployee}/history`),
    ]).then(([docs, rows]) => { setDocuments(docs.documents); setHistory(rows.history); }).catch(() => { setDocuments([]); setHistory([]); });
  }, [selectedEmployee]);

  async function submitEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/hr/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        employeeCode: form.get("employeeCode"), firstName: form.get("firstName"), lastName: form.get("lastName"),
        jobTitle: form.get("jobTitle") || null, hireDate: form.get("hireDate"), status: form.get("status"),
        contractType: form.get("contractType"), nationalIdMasked: form.get("nationalIdMasked") || null,
      }) });
      event.currentTarget.reset();
      setNotice("Fiche employé enregistrée.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Création impossible."); }
  }

  async function submitAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/hr/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        employeeId: form.get("employeeId"), workDate: form.get("workDate"), status: form.get("status"),
        checkIn: form.get("checkIn") || null, checkOut: form.get("checkOut") || null,
        minutesLate: Number(form.get("minutesLate") || 0), note: form.get("note") || null,
      }) });
      setNotice("Présence enregistrée.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
  }

  async function submitLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/hr/leaves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        employeeId: form.get("employeeId"), leaveTypeId: form.get("leaveTypeId"),
        startDate: form.get("startDate"), endDate: form.get("endDate"), reason: form.get("reason") || null,
      }) });
      setNotice("Demande soumise au workflow RH.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Soumission impossible."); }
  }

  async function submitEvaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/v1/hr/evaluations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        employeeId: form.get("employeeId"), periodLabel: form.get("periodLabel"), score: Number(form.get("score")),
        comments: form.get("comments") || null, evaluatedOn: form.get("evaluatedOn"),
      }) });
      setNotice("Évaluation enregistrée.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Évaluation impossible."); }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api(`/api/v1/hr/employees/${selectedEmployee}/documents`, { method: "POST", body: data });
      setNotice("Document confidentiel ajouté au dossier.");
      form.reset();
      const result = await api<{ documents: HrDocument[] }>(`/api/v1/hr/employees/${selectedEmployee}/documents`);
      setDocuments(result.documents);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Import du document impossible."); }
  }

  const headcount = report?.headcount.reduce((sum, row) => sum + row.count, 0) ?? employees.length;
  const employeeOptions = employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.first_name} {employee.last_name}</option>);

  return (
    <section className="hr-shell">
      <div className="hr-toolbar">
        <nav className="hr-tabs" aria-label="Sections RH">
          {[["people", "Employés"], ["attendance", "Présences"], ["leaves", "Congés"], ["evaluations", "Évaluations"], ["documents", "Documents"]].map(([id, label]) =>
            <button type="button" key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
        {canManage && <button className="button hr-primary-action" type="button" onClick={() => setTab("people")}>+ Nouvelle fiche</button>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}

      <div className="hr-metrics">
        <article><span>Effectif actif</span><strong>{headcount}</strong><small>Personnel enregistré</small></article>
        <article><span>Présences du mois</span><strong>{report?.attendanceThisMonth.reduce((sum, row) => sum + row.count, 0) ?? attendance.length}</strong><small>Enregistrements mensuels</small></article>
        <article><span>Congés cette année</span><strong>{leaves.filter((leave) => leave.status === "approved").length}</strong><small>Demandes approuvées</small></article>
      </div>

      {tab === "people" && <>
        {canManage && <form className="hr-panel hr-create-form" onSubmit={submitEmployee}>
          <div className="panel-heading"><div><span className="eyebrow">DOSSIER PERSONNEL</span><h3>Nouvel employé</h3></div></div>
          <div className="hr-form-grid">
            <label>Matricule<input name="employeeCode" required /></label>
            <label>Prénom<input name="firstName" required /></label>
            <label>Nom<input name="lastName" required /></label>
            <label>Fonction<input name="jobTitle" /></label>
            <label>Date d'entrée<input name="hireDate" type="date" required /></label>
            <label>Contrat<select name="contractType"><option value="permanent">Permanent</option><option value="fixed_term">À durée déterminée</option><option value="consultant">Consultant</option><option value="intern">Stagiaire</option><option value="part_time">Temps partiel</option></select></label>
            <label>Statut<select name="status"><option value="active">Actif</option><option value="on_leave">En congé</option><option value="suspended">Suspendu</option><option value="terminated">Terminé</option></select></label>
            <label>Pièce d'identité masquée<input name="nationalIdMasked" placeholder="***-***-1234" maxLength={30} /></label>
          </div>
          <div className="hr-form-actions"><button className="button" type="submit">Créer la fiche</button></div>
        </form>}
        <div className="hr-panel table-scroll">
          <div className="panel-heading"><div><span className="eyebrow">ANNUAIRE</span><h3>Personnel</h3></div><span className="count-pill">{employees.length}</span></div>
          <table><thead><tr><th>Employé</th><th>Fonction</th><th>Direction</th><th>Responsable</th><th>Entrée</th><th>Contrat</th><th>Statut</th></tr></thead>
            <tbody>{employees.map((employee) => <tr key={employee.id}><td><strong>{employee.first_name} {employee.last_name}</strong><span className="table-sub">{employee.employee_code}</span></td><td>{employee.position_title || employee.job_title || "—"}</td><td>{employee.department_name || "—"}</td><td>{employee.manager_name || "—"}</td><td>{employee.hire_date}</td><td>{employee.contract_type || "—"}</td><td><span className={`status-pill hr-status-${employee.status}`}>{statusLabels[employee.status] || employee.status}</span></td></tr>)}</tbody>
          </table>
        </div>
      </>}

      {tab === "attendance" && <>
        {canManageAttendance && <form className="hr-panel hr-inline-form" onSubmit={submitAttendance}>
          <h3>Enregistrer une présence</h3>
          <label>Employé<select name="employeeId" defaultValue={selectedEmployee}>{employeeOptions}</select></label>
          <label>Date<input name="workDate" type="date" required /></label>
          <label>Situation<select name="status"><option value="present">Présent</option><option value="absent">Absent</option><option value="late">Retard</option><option value="permission">Permission</option><option value="remote">Télétravail</option></select></label>
          <label>Arrivée<input name="checkIn" type="time" /></label>
          <label>Départ<input name="checkOut" type="time" /></label>
          <label>Retard (min)<input name="minutesLate" type="number" min="0" defaultValue="0" /></label>
          <label className="hr-span-2">Note<input name="note" /></label>
          <button className="button" type="submit">Enregistrer</button>
        </form>}
        <div className="hr-calendar-grid">
          <div className="hr-panel"><div className="panel-heading"><div><span className="eyebrow">CALENDrier RH</span><h3>Dernières présences</h3></div></div><div className="hr-day-list">{attendance.map((record) => <article key={record.id}><div><span>{record.work_date}</span><strong>{record.first_name} {record.last_name}</strong></div><span className={`status-pill hr-status-${record.status}`}>{statusLabels[record.status] || record.status}</span><small>{record.minutes_late} min de retard</small></article>)}</div></div>
        </div>
      </>}

      {tab === "leaves" && <>
        <form className="hr-panel hr-inline-form" onSubmit={submitLeave}>
          <h3>Nouvelle demande de congé</h3>
          <label>Employé<select name="employeeId" defaultValue={selectedEmployee}>{employeeOptions}</select></label>
          <label>Type<select name="leaveTypeId">{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
          <label>Du<input name="startDate" type="date" required /></label>
          <label>Au<input name="endDate" type="date" required /></label>
          <label className="hr-span-2">Motif<input name="reason" /></label>
          <button className="button" type="submit">Soumettre au workflow</button>
        </form>
        <div className="hr-two-column">
          <div className="hr-panel table-scroll"><div className="panel-heading"><div><span className="eyebrow">DEMANDES</span><h3>Congés</h3></div></div><table><thead><tr><th>Employé</th><th>Type</th><th>Période</th><th>Jours</th><th>Statut</th></tr></thead><tbody>{leaves.map((leave) => <tr key={leave.id}><td><strong>{leave.first_name} {leave.last_name}</strong></td><td>{leave.leave_type_name}</td><td>{leave.start_date} — {leave.end_date}</td><td>{leave.days}</td><td><span className={`status-pill hr-status-${leave.status}`}>{statusLabels[leave.status] || leave.status}</span></td></tr>)}</tbody></table></div>
          <div className="hr-panel table-scroll"><div className="panel-heading"><div><span className="eyebrow">DROITS</span><h3>Soldes</h3></div></div><table><thead><tr><th>Employé</th><th>Congé</th><th>Année</th><th>Acquis</th><th>Pris</th></tr></thead><tbody>{balances.map((balance) => <tr key={balance.employee_id + balance.leave_type_name}><td>{balance.first_name} {balance.last_name}</td><td>{balance.leave_type_name}</td><td>{balance.balance_year}</td><td>{Number(balance.entitled_days) + Number(balance.carried_days)}</td><td>{balance.used_days}</td></tr>)}</tbody></table></div>
        </div>
      </>}

      {tab === "evaluations" && <>
        {canManage && <form className="hr-panel hr-inline-form" onSubmit={submitEvaluation}>
          <h3>Nouvelle évaluation périodique</h3>
          <label>Employé<select name="employeeId" defaultValue={selectedEmployee}>{employeeOptions}</select></label>
          <label>Période<input name="periodLabel" required placeholder="Semestre 1 - 2026" /></label>
          <label>Score /100<input name="score" type="number" min="0" max="100" required /></label>
          <label>Date<input name="evaluatedOn" type="date" required /></label>
          <label className="hr-span-2">Commentaires<textarea name="comments" rows={3} /></label>
          <button className="button" type="submit">Enregistrer</button>
        </form>}
        <div className="hr-panel table-scroll"><div className="panel-heading"><div><span className="eyebrow">PERFORMANCE</span><h3>Évaluations</h3></div></div><table><thead><tr><th>Employé</th><th>Période</th><th>Score</th><th>Date</th></tr></thead><tbody>{evaluations.map((evaluation) => <tr key={evaluation.id}><td><strong>{evaluation.first_name} {evaluation.last_name}</strong></td><td>{evaluation.period_label}</td><td><span className="hr-score">{evaluation.score}/100</span></td><td>{evaluation.evaluated_on}</td></tr>)}</tbody></table></div>
      </>}

      {tab === "documents" && <div className="hr-two-column">
        <div className="hr-panel">
          <div className="panel-heading"><div><span className="eyebrow">CONFIDENTIEL RH</span><h3>Dossier sélectionné</h3></div></div>
          <label>Employé<select value={selectedEmployee} onChange={(event) => setSelectedEmployee(event.target.value)}>{employeeOptions}</select></label>
          <div className="hr-document-list">{documents.map((document) => <article key={document.id}><span>PDF</span><div><strong>{document.title}</strong><small>{document.document_kind}</small></div><a href={`/api/v1/hr/documents/${document.id}`} target="_blank">Télécharger</a></article>)}</div>
          {canManage && <form className="hr-document-upload" onSubmit={uploadDocument}>
            <h3>Ajouter un document confidentiel</h3>
            <label>Nature<select name="documentKind"><option value="identity">Pièce d'identité</option><option value="employment_contract">Contrat de travail</option><option value="medical">Document médical</option><option value="certificate">Certificat</option><option value="other">Autre document RH</option></select></label>
            <label>Fichier PDF, JPEG ou PNG<input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required /></label>
            <button className="button" type="submit">Téléverser</button>
          </form>}
        </div>
        <div className="hr-panel">
          <div className="panel-heading"><div><span className="eyebrow">HISTORIQUE</span><h3>Parcours professionnel</h3></div></div>
          <div className="hr-timeline">{history.map((item) => <article key={item.id}><span>{item.effective_date}</span><strong>{item.change_type}</strong><p>{item.from_value || "—"} → {item.to_value || "—"}</p>{item.note && <small>{item.note}</small>}</article>)}</div>
        </div>
      </div>}
    </section>
  );
}
