"use client";

import { DragEvent, FormEvent, useEffect, useState } from "react";

type Project={id:string;name:string;code:string;status:string;budget_amount:string;currency:string;progress_pct:string;start_date:string|null;end_date:string|null;manager_name:string|null;expenses_usd:string;revenues_usd:string;approval_status:string};
type Task={id:string;project_id:string|null;title:string;status:string;priority:string;due_date:string|null;assignee_name:string|null};
type Activity={id:string;title:string;status:string;planned_date:string|null;project_name:string|null;responsible_name:string|null;recurrence:string};
type Resource={id:string;name:string;resource_type:string;status:string};
type Allocation={id:string;resource_name:string;project_name:string|null;task_title:string|null;from_date:string;to_date:string};
type RefItem={id:string;name:string;full_name?:string};

async function api<T>(url:string,options?:RequestInit):Promise<T>{const r=await fetch(url,options);const b=await r.json().catch(()=>null) as T&{error?:string};if(!r.ok)throw new Error(b?.error||"La requête opérations a échoué.");return b;}

export function OperationsManager({ permissions }: { permissions: string[] }){
  const canManage = permissions.includes("*") || permissions.includes("operations.project.manage") || permissions.includes("operations.task.manage");
  const [tab,setTab]=useState("projects");
  const [projects,setProjects]=useState<Project[]>([]);
  const [tasks,setTasks]=useState<Task[]>([]);
  const [activities,setActivities]=useState<Activity[]>([]);
  const [resources,setResources]=useState<Resource[]>([]);
  const [allocations,setAllocations]=useState<Allocation[]>([]);
  const [entities,setEntities]=useState<RefItem[]>([]);
  const [departments,setDepartments]=useState<RefItem[]>([]);
  const [users,setUsers]=useState<RefItem[]>([]);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  async function load(){try{const d=await api<{projects:Project[];tasks:Task[];activities:Activity[];resources:Resource[];allocations:Allocation[];entities:RefItem[];departments:RefItem[];users:RefItem[]}>("/api/v1/operations");setProjects(d.projects);setTasks(d.tasks);setActivities(d.activities);setResources(d.resources);setAllocations(d.allocations);setEntities(d.entities);setDepartments(d.departments);setUsers(d.users);setError("");}catch(cause){setError(cause instanceof Error?cause.message:"Impossible de charger les opérations.");}}
  useEffect(()=>{void load();},[]);

  async function submit(event:FormEvent<HTMLFormElement>,kind:string){
    event.preventDefault();const form=new FormData(event.currentTarget);const body:Record<string,unknown>={kind};form.forEach((value,key)=>{body[key]=value||null;});
    try{await api("/api/v1/operations/operations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});event.currentTarget.reset();setNotice("Enregistrement effectué.");await load();}catch(cause){setError(cause instanceof Error?cause.message:"Enregistrement impossible.");}
  }

  async function moveTask(event:DragEvent<HTMLElement>,status:string){const id=event.dataTransfer.getData("text/plain");if(!id)return;try{await api(`/api/v1/operations/tasks/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status})});await load();}catch(cause){setError(cause instanceof Error?cause.message:"Transition impossible.");}}

  return <section className="operations-shell">
    <header className="operations-header"><div><span className="eyebrow">OPÉRATIONS</span><h1>Projets, tâches & ressources</h1><p>Planification, suivi de rentabilité et allocation des moyens.</p></div>{!canManage && <span className="operations-access-badge">Consultation seule</span>}</header>
    <nav className="operations-tabs">{[["projects","Projets"],["tasks","Tâches"],["activities","Activités récurrentes"],["resources","Ressources"]].map(([id,label])=><button key={id} type="button" className={tab===id?"active":""} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {error&&<p className="form-error">{error}</p>}{notice&&<p className="form-success">{notice}</p>}
    <div className="operations-metrics"><article><span>Projets actifs</span><strong>{projects.filter((p)=>["planned","in_progress","on_hold"].includes(p.status)).length}</strong></article><article><span>Tâches ouvertes</span><strong>{tasks.filter((t)=>!["done","cancelled"].includes(t.status)).length}</strong></article><article><span>Ressources disponibles</span><strong>{resources.filter((r)=>r.status==="available").length}</strong></article></div>
    {tab==="projects"&&<>
      {canManage && <form className="operations-panel operations-form" onSubmit={(event)=>submit(event,"project")}><h3>Nouveau projet</h3>
        <label>Entité<select name="entityId" required>{entities.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Code<input name="code" required/></label><label>Nom<input name="name" required/></label>
        <label>Direction<select name="departmentId"><option value="">Non assignée</option>{departments.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Responsable<select name="managerId"><option value="">Non assigné</option>{users.map((item)=><option key={item.id} value={item.id}>{item.full_name||item.name}</option>)}</select></label>
        <label>Budget<input name="budgetAmount" type="number" min="0" step="0.01"/></label><label>Devise<select name="currency"><option>USD</option><option>HTG</option></select></label><label>Début<input name="startDate" type="date"/></label><label>Fin<input name="endDate" type="date"/></label>
        <label>Progression<input name="progressPct" type="number" min="0" max="100"/></label><label>Statut<select name="status"><option value="planned">Planifié</option><option value="in_progress">En cours</option><option value="on_hold">En attente</option><option value="completed">Terminé</option><option value="cancelled">Annulé</option></select></label>
        <label className="operations-span-2">Description<textarea name="description" rows={3}/></label><button className="operations-button" type="submit">Créer le projet</button>
      </form>}
      <div className="operations-grid">{projects.map((project)=><article className="operations-project-card" key={project.id}><div className="operations-card-top"><span>{project.code}</span><span className={`status-chip status-${project.status}`}>{project.status}</span></div><h3>{project.name}</h3><p>{project.manager_name||"Responsable non assigné"}</p><div className="operations-progress"><span style={{width:`${Math.min(100,Number(project.progress_pct)||0)}%`}}/></div><div className="operations-project-finance"><span><small>Budget</small><strong>{Number(project.budget_amount).toLocaleString("fr-FR")} {project.currency}</strong></span><span><small>Dépensé USD</small><strong>{Number(project.expenses_usd||0).toLocaleString("fr-FR")}</strong></span><span><small>Rentabilité USD</small><strong>{(Number(project.revenues_usd||0)-Number(project.expenses_usd||0)).toLocaleString("fr-FR")}</strong></span></div></article>)}</div>
    </>}
    {tab==="tasks"&&<>
      {canManage && <form className="operations-panel operations-form operations-task-form" onSubmit={(event)=>submit(event,"task")}><h3>Nouvelle tâche</h3><label>Projet<select name="projectId"><option value="">Sans projet</option>{projects.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Titre<input name="title" required/></label><label>Assigné à<select name="assigneeId"><option value="">Non assigné</option>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name||u.name}</option>)}</select></label><label>Priorité<select name="priority"><option>medium</option><option>low</option><option>high</option><option>urgent</option></select></label><label>Échéance<input name="dueDate" type="date"/></label><button className="operations-button" type="submit">Ajouter</button></form>}
      <div className="operations-kanban">{["todo","in_progress","blocked","done"].map((status)=><section key={status} className="operations-kanban-column" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>moveTask(e,status)}><header><strong>{{todo:"À faire",in_progress:"En cours",blocked:"Bloquée",done:"Terminée"}[status]}</strong><span>{tasks.filter((t)=>t.status===status).length}</span></header>{tasks.filter((t)=>t.status===status).map((task)=><article draggable key={task.id} onDragStart={(e)=>e.dataTransfer.setData("text/plain",task.id)}><span className={`priority-${task.priority}`}>{task.priority}</span><h4>{task.title}</h4><p>{task.assignee_name||"Non assignée"} · {task.due_date||"Sans échéance"}</p></article>)}</section>)}</div>
    </>}
    {tab==="activities"&&<>
      {canManage && <form className="operations-panel operations-form" onSubmit={(event)=>submit(event,"activity")}><h3>Activité récurrente</h3><label>Projet<select name="projectId"><option value="">Sans projet</option>{projects.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Titre<input name="title" required/></label><label>Direction<select name="departmentId"><option value="">Non assignée</option>{departments.map((d)=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Responsable<select name="responsibleId"><option value="">Non assigné</option>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name||u.name}</option>)}</select></label><label>Date<input name="plannedDate" type="date"/></label><label>Récurrence<select name="recurrence"><option value="none">Unique</option><option value="daily">Quotidienne</option><option value="weekly">Hebdomadaire</option><option value="monthly">Mensuelle</option></select></label><label>Jusqu’au<input name="recurrenceUntil" type="date"/></label><button className="operations-button" type="submit">Planifier</button></form>}
      <div className="operations-grid">{activities.map((activity)=><article className="operations-project-card" key={activity.id}><div className="operations-card-top"><span>{activity.recurrence}</span><span>{activity.status}</span></div><h3>{activity.title}</h3><p>{activity.project_name||"Organisation générale"}</p><small>{activity.planned_date||"Date à définir"} · {activity.responsible_name||"Responsable à définir"}</small></article>)}</div>
    </>}
    {tab==="resources"&&<>
      {canManage && <form className="operations-panel operations-form operations-task-form" onSubmit={(event)=>submit(event,"resource")}><h3>Nouvelle ressource</h3><label>Nom<input name="name" required/></label><label>Type<select name="resourceType"><option value="equipment">Équipement</option><option value="vehicle">Véhicule</option><option value="room">Salle</option><option value="software">Logiciel</option><option value="other">Autre</option></select></label><button className="operations-button" type="submit">Ajouter</button></form>}
      {canManage && <form className="operations-panel operations-form" onSubmit={(event)=>submit(event,"allocation")}><h3>Allocation</h3><label>Ressource<select name="resourceId" required>{resources.map((r)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label>Projet<select name="projectId"><option value="">Aucun</option>{projects.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Du<input name="fromDate" type="date" required/></label><label>Au<input name="toDate" type="date" required/></label><button className="operations-button" type="submit">Allouer</button></form>}
      <div className="operations-panel operations-table-scroll"><table><thead><tr><th>Ressource</th><th>Projet / tâche</th><th>Période</th></tr></thead><tbody>{allocations.map((item)=><tr key={item.id}><td><strong>{item.resource_name}</strong></td><td>{item.project_name||item.task_title||"—"}</td><td>{item.from_date} — {item.to_date}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}
