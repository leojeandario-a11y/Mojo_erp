"use client";

import { FormEvent, useEffect, useState } from "react";
import { RecordDetailsDialog, SuperAdminRecordActions, type RecordActionLabels, type RecordDetail } from "@/components/super-admin-record-actions";

type Campaign = { id:string; entity_id:string; department_id:string|null; project_id:string|null; owner_id:string|null; channels:string[]; name:string; objective:string|null; planned_budget:string; currency:string; start_date:string|null; end_date:string|null; owner_name:string|null; status:string; spent_usd:string };
type ContentItem = { id:string; campaign_id:string|null; title:string; content_type:string; channel:string|null; scheduled_at:string|null; published_at:string|null; owner_id:string|null; body:string|null; status:string };
type Result = { id:string; campaign_id:string; recorded_on:string; channel:string|null; impressions:number; clicks:number; leads:number; conversions:number; revenue_generated:string };
type RefItem = { id:string; name:string; full_name?:string };

async function api<T>(url:string, options?:RequestInit):Promise<T> {
  const response=await fetch(url,options);
  const body=await response.json().catch(()=>null) as T & {error?:string};
  if(!response.ok) throw new Error(body?.error||"La requête marketing a échoué.");
  return body;
}

export function MarketingManager({ permissions, isSuperAdmin, actionLabels }: { permissions: string[]; isSuperAdmin: boolean; actionLabels: RecordActionLabels }) {
  const canManage = isSuperAdmin || permissions.includes("*") || permissions.includes("marketing.campaign.manage") || permissions.includes("marketing.content.manage");
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
  const [editingCampaign,setEditingCampaign]=useState<Campaign|null>(null);
  const [editingContent,setEditingContent]=useState<ContentItem|null>(null);
  const [detail,setDetail]=useState<RecordDetail|null>(null);

  async function load() {
    try {
      const data=await api<{campaigns:Campaign[];content:ContentItem[];results:Result[];entities:RefItem[];departments:RefItem[];projects:RefItem[];users:RefItem[]}>("/api/v1/marketing");
      setCampaigns(data.campaigns); setContent(data.content); setResults(data.results); setEntities(data.entities); setDepartments(data.departments); setProjects(data.projects); setUsers(data.users); setError("");
    } catch(cause){setError(cause instanceof Error?cause.message:"Impossible de charger le marketing.");}
  }
  useEffect(()=>{void load();},[]);

  async function submit(event:FormEvent<HTMLFormElement>, kind:string) {
    event.preventDefault();
    const formElement=event.currentTarget;
    const form=new FormData(formElement);
    const body:Record<string,unknown>={kind};
    form.forEach((value,key)=>{body[key]=value||null;});
    if(kind==="campaign"){body.channels=String(form.get("channels")||"").split(",").map((v)=>v.trim()).filter(Boolean);}
    const editing=kind==="campaign"?editingCampaign:kind==="content"?editingContent:null;
    if(editing)delete body.kind;
    const endpoint=editing
      ? `/api/v1/marketing/${kind==="campaign"?"campaigns":"content"}/${editing.id}`
      : kind==="campaign"?"/api/v1/marketing":"/api/v1/marketing/operations";
    try {
      await api(endpoint,{method:editing?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      formElement.reset();setEditingCampaign(null);setEditingContent(null);setNotice("Enregistrement effectué.");await load();
    } catch(cause){setError(cause instanceof Error?cause.message:"Enregistrement impossible.");}
  }

  async function deleteItem(endpoint:string,label:string){
    if(!window.confirm(`Confirmer la suppression de « ${label} » ?`))return;
    try{const result=await api<{archived?:boolean}>(endpoint,{method:"DELETE"});setNotice(result.archived?`${label} archivé pour préserver son historique.`:`${label} supprimé.`);setError("");await load();}catch(cause){setError(cause instanceof Error?cause.message:"Suppression impossible.");}
  }

  function openCampaign(item:Campaign){setDetail({title:item.name,fields:[{label:"Objectif",value:item.objective},{label:"Responsable",value:item.owner_name},{label:"Période",value:`${item.start_date??"—"} — ${item.end_date??"—"}`},{label:"Budget",value:`${item.planned_budget} ${item.currency}`},{label:"Dépenses validées",value:`${item.spent_usd} USD`},{label:"Canaux",value:item.channels.join(", ")},{label:"Statut",value:item.status}]});}
  function openContent(item:ContentItem){setDetail({title:item.title,fields:[{label:"Campagne",value:campaigns.find((campaign)=>campaign.id===item.campaign_id)?.name},{label:"Format",value:item.content_type},{label:"Chaîne",value:item.channel},{label:"Planification",value:item.scheduled_at},{label:"Publication",value:item.published_at},{label:"Statut",value:item.status},{label:"Contenu",value:item.body}]});}
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
      {canManage && <form key={editingCampaign?.id??"new-campaign"} className="operations-panel operations-form" onSubmit={(event)=>submit(event,"campaign")}><h3>{editingCampaign?"Modifier la campagne":"Nouvelle campagne"}</h3>
        <label>Entité<select name="entityId" required defaultValue={editingCampaign?.entity_id??entities[0]?.id??""}>{entities.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Nom<input name="name" required defaultValue={editingCampaign?.name??""}/></label><label>Objectif<input name="objective" defaultValue={editingCampaign?.objective??""}/></label>
        <label>Direction<select name="departmentId" defaultValue={editingCampaign?.department_id??""}><option value="">Non assignée</option>{departments.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Projet<select name="projectId" defaultValue={editingCampaign?.project_id??""}><option value="">Aucun</option>{projects.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Responsable<select name="ownerId" defaultValue={editingCampaign?.owner_id??""}><option value="">Non assigné</option>{users.map((item)=><option key={item.id} value={item.id}>{item.full_name||item.name}</option>)}</select></label>
        <label>Budget<input name="plannedBudget" type="number" min="0" step="0.01" defaultValue={editingCampaign?.planned_budget??"0"}/></label><label>Devise<select name="currency" defaultValue={editingCampaign?.currency??"USD"}><option>USD</option><option>HTG</option></select></label>
        <label>Début<input name="startDate" type="date" defaultValue={editingCampaign?.start_date??""}/></label><label>Fin<input name="endDate" type="date" defaultValue={editingCampaign?.end_date??""}/></label>
        <label>Statut<select name="status" defaultValue={editingCampaign?.status??"planned"}><option value="planned">Planifiée</option><option value="running">En cours</option><option value="paused">En pause</option><option value="completed">Terminée</option><option value="cancelled">Annulée</option></select></label>
        <label className="operations-span-2">Canaux (séparés par des virgules)<input name="channels" placeholder="Facebook, Instagram, Événement" defaultValue={editingCampaign?.channels.join(", ")??""}/></label>
        <div className="operations-form-actions"><button className="operations-button" type="submit">{editingCampaign?"Enregistrer les modifications":"Créer la campagne"}</button>{editingCampaign&&<button className="button button-secondary" type="button" onClick={()=>setEditingCampaign(null)}>Annuler</button>}</div>
      </form>}
      <div className="operations-panel operations-table-scroll"><div className="operations-panel-heading"><h3>Portefeuille marketing</h3><span className="operations-count">{campaigns.length}</span></div><table><thead><tr><th>Campagne</th><th>Responsable</th><th>Période</th><th>Budget</th><th>Dépenses validées</th><th>Statut</th><th>{isSuperAdmin?"Actions":null}</th></tr></thead><tbody>{campaigns.map((item)=><tr key={item.id}><td><strong>{item.name}</strong><span className="operations-table-sub">{item.objective||"Sans objectif"}</span></td><td>{item.owner_name||"—"}</td><td>{item.start_date||"—"} — {item.end_date||"—"}</td><td>{Number(item.planned_budget).toLocaleString("fr-FR")} {item.currency}</td><td>{Number(item.spent_usd||0).toLocaleString("fr-FR")} USD</td><td><span className={`status-chip status-${item.status}`}>{item.status}</span></td><td><SuperAdminRecordActions isSuperAdmin={isSuperAdmin} labels={actionLabels} onOpen={()=>openCampaign(item)} onEdit={()=>setEditingCampaign(item)} onDelete={()=>void deleteItem(`/api/v1/marketing/campaigns/${item.id}`,item.name)}/></td></tr>)}</tbody></table></div>
    </>}
    {tab==="content"&&<>
      {canManage && <form key={editingContent?.id??"new-content"} className="operations-panel operations-form" onSubmit={(event)=>submit(event,"content")}><h3>{editingContent?"Modifier le contenu":"Planifier du contenu"}</h3>
        <label>Campagne<select name="campaignId" defaultValue={editingContent?.campaign_id??""}><option value="">Non liée</option>{campaigns.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Titre<input name="title" required defaultValue={editingContent?.title??""}/></label><label>Format<select name="contentType" defaultValue={editingContent?.content_type??"post"}><option value="post">Publication</option><option value="visual">Visuel</option><option value="video">Vidéo</option><option value="article">Article</option><option value="ad">Publicité</option><option value="other">Autre</option></select></label>
        <label>Chaîne<input name="channel" defaultValue={editingContent?.channel??""}/></label><label>Planification<input name="scheduledAt" type="datetime-local" defaultValue={editingContent?.scheduled_at?.slice(0,16)??""}/></label><label>Statut<select name="status" defaultValue={editingContent?.status??"idea"}><option value="idea">Idée</option><option value="in_production">Production</option><option value="scheduled">Planifié</option><option value="published">Publié</option><option value="cancelled">Annulé</option></select></label>
        <label className="operations-span-2">Texte / brief<textarea name="body" rows={3} defaultValue={editingContent?.body??""}/></label><div className="operations-form-actions"><button className="operations-button" type="submit">{editingContent?"Enregistrer les modifications":"Ajouter au planning"}</button>{editingContent&&<button className="button button-secondary" type="button" onClick={()=>setEditingContent(null)}>Annuler</button>}</div>
      </form>}
      <div className="operations-panel operations-table-scroll"><table><thead><tr><th>Contenu</th><th>Format</th><th>Chaîne</th><th>Planification</th><th>Statut</th><th>{isSuperAdmin?"Actions":null}</th></tr></thead><tbody>{content.map((item)=><tr key={item.id}><td><strong>{item.title}</strong></td><td>{item.content_type}</td><td>{item.channel||"—"}</td><td>{item.scheduled_at||"—"}</td><td>{item.status}</td><td><SuperAdminRecordActions isSuperAdmin={isSuperAdmin} labels={actionLabels} onOpen={()=>openContent(item)} onEdit={()=>setEditingContent(item)} onDelete={()=>void deleteItem(`/api/v1/marketing/content/${item.id}`,item.title)} editDisabled={item.status==="published"||Boolean(item.published_at)} editTitle={item.status==="published"||item.published_at?"Un contenu publié ne peut pas être modifié.":undefined} deleteDisabled={item.status==="published"||Boolean(item.published_at)} deleteTitle={item.status==="published"||item.published_at?"Un contenu publié doit rester dans l’historique.":undefined}/></td></tr>)}</tbody></table></div>
    </>}
    {tab==="results"&&<>
      {canManage && <form className="operations-panel operations-form" onSubmit={(event)=>submit(event,"result")}><h3>Ajouter des résultats</h3>
        <label>Campagne<select name="campaignId" required>{campaigns.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Date<input name="recordedOn" type="date" required/></label><label>Chaîne<input name="channel"/></label><label>Impressions<input name="impressions" type="number" min="0"/></label><label>Clics<input name="clicks" type="number" min="0"/></label><label>Prospects<input name="leads" type="number" min="0"/></label><label>Conversions<input name="conversions" type="number" min="0"/></label><label>Revenu<input name="revenueGenerated" type="number" min="0" step="0.01"/></label>
        <label>Devise<select name="currency"><option>USD</option><option>HTG</option></select></label><label className="operations-span-2">Notes<textarea name="notes" rows={2}/></label><button className="operations-button" type="submit">Enregistrer les résultats</button>
      </form>}
      <div className="operations-panel operations-table-scroll"><table><thead><tr><th>Date</th><th>Chaîne</th><th>Impressions</th><th>Clics</th><th>Prospects</th><th>Conversions</th><th>Revenu</th></tr></thead><tbody>{results.map((item)=><tr key={item.id}><td>{item.recorded_on}</td><td>{item.channel||"—"}</td><td>{Number(item.impressions||0).toLocaleString("fr-FR")}</td><td>{Number(item.clicks||0).toLocaleString("fr-FR")}</td><td>{item.leads}</td><td>{item.conversions}</td><td>{Number(item.revenue_generated||0).toLocaleString("fr-FR")} USD</td></tr>)}</tbody></table></div>
    </>}
    <RecordDetailsDialog detail={detail} closeLabel="Fermer" onClose={()=>setDetail(null)}/>
  </section>;
}
