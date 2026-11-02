"use client";

import { FormEvent, useEffect, useState } from "react";

type Campaign = { id:string; name:string; objective:string|null; planned_budget:string; currency:string; start_date:string|null; end_date:string|null; owner_name:string|null; status:string; spent_usd:string };
type ContentItem = { id:string; title:string; content_type:string; channel:string|null; scheduled_at:string|null; status:string };
type Result = { id:string; campaign_id:string; recorded_on:string; channel:string|null; impressions:number; clicks:number; leads:number; conversions:number; revenue_generated:string };
type RefItem = { id:string; name:string; full_name?:string };

async function api<T>(url:string, options?:RequestInit):Promise<T> {
  const response=await fetch(url,options);
  const body=await response.json().catch(()=>null) as T & {error?:string};
  if(!response.ok) throw new Error(body?.error||"La requête marketing a échoué.");
  return body;
}

export function MarketingManager({ permissions }: { permissions: string[] }) {
  const canManage = permissions.includes("*") || permissions.includes("marketing.campaign.manage") || permissions.includes("marketing.content.manage");
  const [tab,setTab]=useState("campaigns");
  const [campaigns,setCampaigns]=useState<Campaign[]>([]);
  const [content,setContent]=useState<ContentItem[]>([]);
  const [results,setResults]=useState<Result[]>([]);
  const [entities,setEntities]=useState<RefItem[]>([]);
  const [departments,setDepartments]=useState<RefItem[]>([]);
  const [projects,setProjects]=useState<RefItem[]>([]);
  const [users,setUsers]=useState<RefItem[]>([]);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  async function load() {
    try {
      const data=await api<{campaigns:Campaign[];content:ContentItem[];results:Result[];entities:RefItem[];departments:RefItem[];projects:RefItem[];users:RefItem[]}>("/api/v1/marketing");
      setCampaigns(data.campaigns); setContent(data.content); setResults(data.results); setEntities(data.entities); setDepartments(data.departments); setProjects(data.projects); setUsers(data.users); setError("");
    } catch(cause){setError(cause instanceof Error?cause.message:"Impossible de charger le marketing.");}
  }
  useEffect(()=>{void load();},[]);

  async function submit(event:FormEvent<HTMLFormElement>, kind:string) {
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const body:Record<string,unknown>={kind};
    form.forEach((value,key)=>{body[key]=value||null;});
    if(kind==="campaign"){body.channels=String(form.get("channels")||"").split(",").map((v)=>v.trim()).filter(Boolean);}
    try {
      await api(kind==="campaign"?"/api/v1/marketing":"/api/v1/marketing/operations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      event.currentTarget.reset();setNotice("Enregistrement effectué.");await load();
    } catch(cause){setError(cause instanceof Error?cause.message:"Enregistrement impossible.");}
  }

  const totalBudget=campaigns.reduce((sum,item)=>sum+Number(item.planned_budget||0),0);
  const totalRevenue=results.reduce((sum,item)=>sum+Number(item.revenue_generated||0),0);
  return <section className="operations-shell">
    <header className="operations-header"><div><span className="eyebrow">MARKETING</span><h1>Performance & campagnes</h1><p>Budget, contenus, résultats et suivi de rentabilité.</p></div>{!canManage && <span className="operations-access-badge">Consultation seule</span>}</header>
    <nav className="operations-tabs">{[["campaigns","Campagnes"],["content","Contenu éditorial"],["results","Résultats & rapports"]].map(([id,label])=><button key={id} type="button" className={tab===id?"active":""} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {error&&<p className="form-error">{error}</p>}{notice&&<p className="form-success">{notice}</p>}
    <div className="operations-metrics">
      <article><span>Campagnes actives</span><strong>{campaigns.filter((item)=>!["cancelled","completed"].includes(item.status)).length}</strong></article>
      <article><span>Budget prévu</span><strong>{totalBudget.toLocaleString("fr-FR")} USD</strong></article>
      <article><span>Revenus suivis</span><strong>{totalRevenue.toLocaleString("fr-FR")} USD</strong></article>
    </div>
    {tab==="campaigns"&&<>
      {canManage && <form className="operations-panel operations-form" onSubmit={(event)=>submit(event,"campaign")}><h3>Nouvelle campagne</h3>
        <label>Entité<select name="entityId" required>{entities.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Nom<input name="name" required/></label><label>Objectif<input name="objective"/></label>
        <label>Direction<select name="departmentId"><option value="">Non assignée</option>{departments.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Projet<select name="projectId"><option value="">Aucun</option>{projects.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Responsable<select name="ownerId"><option value="">Non assigné</option>{users.map((item)=><option key={item.id} value={item.id}>{item.full_name||item.name}</option>)}</select></label>
        <label>Budget<input name="plannedBudget" type="number" min="0" step="0.01"/></label><label>Devise<select name="currency"><option>USD</option><option>HTG</option></select></label>
        <label>Début<input name="startDate" type="date"/></label><label>Fin<input name="endDate" type="date"/></label>
        <label className="operations-span-2">Canaux (séparés par des virgules)<input name="channels" placeholder="Facebook, Instagram, Événement"/></label>
        <button className="operations-button" type="submit">Créer la campagne</button>
      </form>}
      <div className="operations-panel operations-table-scroll"><div className="operations-panel-heading"><h3>Portefeuille marketing</h3><span className="operations-count">{campaigns.length}</span></div><table><thead><tr><th>Campagne</th><th>Responsable</th><th>Période</th><th>Budget</th><th>Dépenses validées</th><th>Statut</th></tr></thead><tbody>{campaigns.map((item)=><tr key={item.id}><td><strong>{item.name}</strong><span className="operations-table-sub">{item.objective||"Sans objectif"}</span></td><td>{item.owner_name||"—"}</td><td>{item.start_date||"—"} — {item.end_date||"—"}</td><td>{Number(item.planned_budget).toLocaleString("fr-FR")} {item.currency}</td><td>{Number(item.spent_usd||0).toLocaleString("fr-FR")} USD</td><td><span className={`status-chip status-${item.status}`}>{item.status}</span></td></tr>)}</tbody></table></div>
    </>}
    {tab==="content"&&<>
      {canManage && <form className="operations-panel operations-form" onSubmit={(event)=>submit(event,"content")}><h3>Planifier du contenu</h3>
        <label>Campagne<select name="campaignId"><option value="">Non liée</option>{campaigns.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Titre<input name="title" required/></label><label>Format<select name="contentType"><option value="post">Publication</option><option value="visual">Visuel</option><option value="video">Vidéo</option><option value="article">Article</option><option value="ad">Publicité</option><option value="other">Autre</option></select></label>
        <label>Chaîne<input name="channel"/></label><label>Planification<input name="scheduledAt" type="datetime-local"/></label><label>Statut<select name="status"><option value="idea">Idée</option><option value="in_production">Production</option><option value="scheduled">Planifié</option><option value="published">Publié</option><option value="cancelled">Annulé</option></select></label>
        <label className="operations-span-2">Texte / brief<textarea name="body" rows={3}/></label><button className="operations-button" type="submit">Ajouter au planning</button>
      </form>}
      <div className="operations-panel operations-table-scroll"><table><thead><tr><th>Contenu</th><th>Format</th><th>Chaîne</th><th>Planification</th><th>Statut</th></tr></thead><tbody>{content.map((item)=><tr key={item.id}><td><strong>{item.title}</strong></td><td>{item.content_type}</td><td>{item.channel||"—"}</td><td>{item.scheduled_at||"—"}</td><td>{item.status}</td></tr>)}</tbody></table></div>
    </>}
    {tab==="results"&&<>
      {canManage && <form className="operations-panel operations-form" onSubmit={(event)=>submit(event,"result")}><h3>Ajouter des résultats</h3>
        <label>Campagne<select name="campaignId" required>{campaigns.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Date<input name="recordedOn" type="date" required/></label><label>Chaîne<input name="channel"/></label><label>Impressions<input name="impressions" type="number" min="0"/></label><label>Clics<input name="clicks" type="number" min="0"/></label><label>Prospects<input name="leads" type="number" min="0"/></label><label>Conversions<input name="conversions" type="number" min="0"/></label><label>Revenu<input name="revenueGenerated" type="number" min="0" step="0.01"/></label>
        <label>Devise<select name="currency"><option>USD</option><option>HTG</option></select></label><label className="operations-span-2">Notes<textarea name="notes" rows={2}/></label><button className="operations-button" type="submit">Enregistrer les résultats</button>
      </form>}
      <div className="operations-panel operations-table-scroll"><table><thead><tr><th>Date</th><th>Chaîne</th><th>Impressions</th><th>Clics</th><th>Prospects</th><th>Conversions</th><th>Revenu</th></tr></thead><tbody>{results.map((item)=><tr key={item.id}><td>{item.recorded_on}</td><td>{item.channel||"—"}</td><td>{Number(item.impressions||0).toLocaleString("fr-FR")}</td><td>{Number(item.clicks||0).toLocaleString("fr-FR")}</td><td>{item.leads}</td><td>{item.conversions}</td><td>{Number(item.revenue_generated||0).toLocaleString("fr-FR")} USD</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}
