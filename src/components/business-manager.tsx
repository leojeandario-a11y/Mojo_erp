"use client";

import { useEffect, useState, type DragEvent, type FormEvent } from "react";

type Customer = { id:string; kind:string; company_name:string|null; full_name:string; email:string|null; phone:string|null; owner_name:string|null };
type Opportunity = { id:string; title:string; customer_id:string; full_name:string; company_name:string|null; stage:string; estimated_amount:string|null; currency:string|null; expected_close:string|null; owner_name:string|null; service_requested:string|null; pending_reminders:number };
type Reminder = { id:string; opportunity_id:string; title:string; remind_on:string; note:string|null; status:string };
type Supplier = { id:string; name:string; contact_name:string|null; email:string|null; phone:string|null; is_active:boolean };
type Partner = { id:string; name:string; partner_type:string; contact_name:string|null; email:string|null; status:string };
type Contact = { id:string; customer_id:string; full_name:string; job_title:string|null; email:string|null; phone:string|null };
type Interaction = { id:string; customer_id:string; interaction_type:string; summary:string; occurred_at:string; full_name:string };
type BusinessData = { customers:Customer[]; contacts:Contact[]; interactions:Interaction[]; opportunities:Opportunity[]; reminders:Reminder[]; suppliers:Supplier[]; partners:Partner[] };
type Contract = { id:string; contract_number:string; title:string; contract_kind:string; status:string; amount:string|null; currency:string|null; start_date:string|null; end_date:string|null; company_name:string|null; full_name:string|null; supplier_name:string|null; partner_name:string|null };
type Invoice = { id:string; invoice_number:string; company_name:string|null; full_name:string; issue_date:string; due_date:string; total:string; paid:string; currency:string; status:string };

const stages = [
  ["prospect","Prospect"],["contact","Contact"],["proposal","Proposition"],["negotiation","Négociation"],
  ["contract","Contrat"],["client","Client"],["delivery","Livraison"],["payment","Paiement"],
] as const;

async function api<T>(url:string, options?:RequestInit):Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null) as T & { error?:string };
  if (!response.ok) throw new Error(body?.error || "La requête affaires a échoué.");
  return body;
}

export function BusinessManager() {
  const [tab,setTab] = useState("pipeline");
  const [data,setData] = useState<BusinessData | null>(null);
  const [contracts,setContracts] = useState<Contract[]>([]);
  const [invoices,setInvoices] = useState<Invoice[]>([]);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");

  async function load() {
    try { setData(await api<BusinessData>("/api/v1/business")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Impossible de charger les affaires."); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!["contracts","invoices"].includes(tab)) return;
    Promise.all([api<{contracts:Contract[]}>("/api/v1/business/contracts"),api<{invoices:Invoice[]}>("/api/v1/business/invoices")])
      .then(([contractData,invoiceData])=>{setContracts(contractData.contracts);setInvoices(invoiceData.invoices);})
      .catch((cause)=>setError(cause instanceof Error?cause.message:"Impossible de charger les contrats et factures."));
  },[tab]);

  async function submit(event:FormEvent<HTMLFormElement>, endpoint:string, extra:Record<string,unknown> = {}) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body:Record<string,unknown> = {...extra};
    form.forEach((value,key) => { body[key] = value || null; });
    try {
      await api(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      formElement.reset(); setNotice("Enregistrement effectué."); await load();
    } catch(cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
  }

  async function moveOpportunity(event:DragEvent<HTMLElement>, stage:string) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    if (!id) return;
    try {
      await api(`/api/v1/business/opportunities/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({stage})});
      setNotice("Étape modifiée et historique enregistré.");
      await load();
    } catch(cause) { setError(cause instanceof Error ? cause.message : "Transition impossible."); }
  }

  async function moveFromCard(event:DragEvent<HTMLElement>, id:string) {
    event.dataTransfer.setData("text/plain",id);
    event.dataTransfer.effectAllowed = "move";
  }

  async function submitContract(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form=new FormData(formElement);
    const contractKind=form.get("contractKind");
    const partyId=form.get("partyId");
    const body:Record<string,unknown>={contractKind,contractNumber:form.get("contractNumber"),title:form.get("title"),amount:Number(form.get("amount"))||null,currency:form.get("currency"),startDate:form.get("startDate")||null,endDate:form.get("endDate")||null,renewalDate:form.get("renewalDate")||null,autoRenew:form.get("autoRenew")==="on",terms:form.get("terms")||null};
    if(contractKind==="client") body.customerId=partyId;
    if(contractKind==="supplier") body.supplierId=partyId;
    if(contractKind==="partner") body.partnerId=partyId;
    try { await api("/api/v1/business/contracts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); formElement.reset();setNotice("Contrat créé.");setContracts((await api<{contracts:Contract[]}>("/api/v1/business/contracts")).contracts); }
    catch(cause){setError(cause instanceof Error?cause.message:"Création du contrat impossible.");}
  }

  async function submitInvoice(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form=new FormData(formElement);
    const body={customerId:form.get("customerId"),contractId:form.get("contractId")||null,issueDate:form.get("issueDate"),dueDate:form.get("dueDate"),currency:form.get("currency"),discount:Number(form.get("discount")||0),taxAmount:Number(form.get("taxAmount")||0),notes:form.get("notes")||null,lines:[{description:form.get("description"),quantity:Number(form.get("quantity")),unitPrice:Number(form.get("unitPrice"))}]};
    try { await api("/api/v1/business/invoices",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});formElement.reset();setNotice("Facture émise.");setInvoices((await api<{invoices:Invoice[]}>("/api/v1/business/invoices")).invoices); }
    catch(cause){setError(cause instanceof Error?cause.message:"Création de la facture impossible.");}
  }

  async function submitPayment(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form=new FormData(formElement);
    const body={invoiceId:form.get("invoiceId"),amount:Number(form.get("amount")),currency:form.get("currency"),fxRate:Number(form.get("fxRate")||1),method:form.get("method"),paidAt:form.get("paidAt"),reference:form.get("reference")||null};
    try { await api("/api/v1/business/payments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});formElement.reset();setNotice("Encaissement enregistré et revenu relié.");setInvoices((await api<{invoices:Invoice[]}>("/api/v1/business/invoices")).invoices); }
    catch(cause){setError(cause instanceof Error?cause.message:"Encaissement impossible.");}
  }

  const customers = data?.customers ?? [];
  const opportunities = data?.opportunities ?? [];

  return (
    <section className="business-shell">
      <header className="business-header"><div><span className="eyebrow">AFFAIRES</span><h1>Gestion commerciale</h1><p>Prospection, relations, pipeline et partenaires.</p></div><a className="button button-secondary" href="/api/v1/business/reports">Exporter le rapport</a></header>
      <nav className="business-tabs" aria-label="Sections affaires">
        {[["pipeline","Pipeline"],["customers","Clients & prospects"],["contracts","Contrats"],["invoices","Factures & encaissements"],["partners","Fournisseurs & partenaires"],["reminders","Relances"]].map(([id,label]) =>
          <button className={tab===id?"active":""} type="button" key={id} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}

      {tab==="pipeline" && <>
        <div className="business-metrics">
          <article><span>Opportunités actives</span><strong>{opportunities.filter((item) => item.stage !== "lost").length}</strong></article>
          <article><span>Pipeline estimé</span><strong>{opportunities.reduce((total,item) => total + (item.stage==="lost"?0:Number(item.estimated_amount||0)),0).toLocaleString("fr-FR")}</strong></article>
          <article><span>Relances en attente</span><strong>{opportunities.reduce((total,item) => total + Number(item.pending_reminders||0),0)}</strong></article>
        </div>
        <form className="business-panel business-opportunity-form" onSubmit={(event) => submit(event,"/api/v1/business/opportunities",{})}>
          <h3>Nouvelle affaire</h3>
          <label>Client / prospect<select name="customerId" required>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.company_name || customer.full_name}</option>)}</select></label>
          <label>Titre<input name="title" required /></label>
          <label>Service demandé<input name="serviceRequested" /></label>
          <label>Montant estimé<input name="estimatedAmount" type="number" min="0" step="0.01" /></label>
          <label>Devise<select name="currency"><option value="USD">USD</option><option value="HTG">HTG</option></select></label>
          <label>Clôture prévue<input name="expectedClose" type="date" /></label>
          <button className="button" type="submit">Créer</button>
        </form>
        <div className="business-kanban">
          {stages.map(([stage,label]) =>
            <section key={stage} className="business-kanban-column" onDragOver={(event) => event.preventDefault()} onDrop={(event) => moveOpportunity(event,stage)}>
              <header><strong>{label}</strong><span>{opportunities.filter((item) => item.stage===stage).length}</span></header>
              <div className="business-kanban-list">
                {opportunities.filter((item) => item.stage===stage).map((opportunity) =>
                  <article draggable key={opportunity.id} onDragStart={(event) => moveFromCard(event,opportunity.id)}>
                    <span className="business-card-owner">{opportunity.owner_name || "Non assignée"}</span>
                    <h4>{opportunity.title}</h4>
                    <p>{opportunity.company_name || opportunity.full_name}</p>
                    {opportunity.estimated_amount && <strong>{Number(opportunity.estimated_amount).toLocaleString("fr-FR")} {opportunity.currency}</strong>}
                    <small>{opportunity.expected_close || "Aucune échéance"}</small>
                  </article>)}
              </div>
            </section>)}
        </div>
      </>}

      {tab==="customers" && <>
        <form className="business-panel business-form" onSubmit={(event) => submit(event,"/api/v1/business/customers",{type:"customer"})}>
          <h3>Ajouter un client ou prospect</h3>
          <label>Type<select name="kind"><option value="prospect">Prospect</option><option value="client">Client</option></select></label>
          <label>Nom complet<input name="fullName" required /></label>
          <label>Entreprise<input name="companyName" /></label>
          <label>Email<input name="email" type="email" /></label>
          <label>Téléphone<input name="phone" /></label>
          <label className="business-span-2">Adresse<input name="address" /></label>
          <label className="business-span-2">Notes<textarea name="notes" rows={3} /></label>
          <button className="button" type="submit">Enregistrer</button>
        </form>
        <div className="business-two-column">
          <div className="business-panel table-scroll"><div className="panel-heading"><h3>Répertoire</h3><span className="count-pill">{customers.length}</span></div><table><thead><tr><th>Nom</th><th>Contact</th><th>Responsable</th><th>Type</th></tr></thead><tbody>{customers.map((customer)=><tr key={customer.id}><td><strong>{customer.company_name || customer.full_name}</strong><span className="table-sub">{customer.full_name}</span></td><td>{customer.email || customer.phone || "—"}</td><td>{customer.owner_name || "—"}</td><td>{customer.kind==="client"?"Client":"Prospect"}</td></tr>)}</tbody></table></div>
          <form className="business-panel business-form" onSubmit={(event) => submit(event,"/api/v1/business/customers",{type:"interaction"})}><h3>Historique d'échange</h3><label>Relation<select name="customerId" required>{customers.map((customer)=><option key={customer.id} value={customer.id}>{customer.company_name || customer.full_name}</option>)}</select></label><label>Type<select name="interactionType"><option value="call">Appel</option><option value="meeting">Réunion</option><option value="email">Email</option><option value="message">Message</option><option value="visit">Visite</option><option value="other">Autre</option></select></label><label className="business-span-2">Compte rendu<textarea name="summary" rows={4} required /></label><button className="button" type="submit">Ajouter</button></form>
        </div>
      </>}

      {tab==="contracts" && <>
        <form className="business-panel business-form" onSubmit={submitContract}>
          <h3>Nouveau contrat</h3>
          <label>Numéro<input name="contractNumber" required /></label>
          <label>Titre<input name="title" required /></label>
          <label>Type<select name="contractKind"><option value="client">Client</option><option value="supplier">Fournisseur</option><option value="partner">Partenaire</option><option value="exhibitor">Exposant</option></select></label>
          <label>Contrepartie<select name="partyId">{customers.map((customer)=><option key={customer.id} value={customer.id}>{customer.company_name||customer.full_name}</option>)}{data?.suppliers.map((supplier)=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          <label>Montant<input name="amount" type="number" min="0" step="0.01" /></label>
          <label>Devise<select name="currency"><option value="USD">USD</option><option value="HTG">HTG</option></select></label>
          <label>Début<input name="startDate" type="date" /></label>
          <label>Fin<input name="endDate" type="date" /></label>
          <label>Renouvellement<input name="renewalDate" type="date" /></label>
          <label>Renouvellement auto<select name="autoRenew"><option value="">Non</option><option value="on">Oui</option></select></label>
          <label className="business-span-2">Conditions<textarea name="terms" rows={3} /></label>
          <button className="button" type="submit">Créer le contrat</button>
        </form>
        <div className="business-panel table-scroll"><div className="panel-heading"><h3>Contrats</h3><span className="count-pill">{contracts.length}</span></div><table><thead><tr><th>Numéro</th><th>Titre</th><th>Contrepartie</th><th>Montant</th><th>Période</th><th>Statut</th></tr></thead><tbody>{contracts.map((contract)=><tr key={contract.id}><td>{contract.contract_number}</td><td><strong>{contract.title}</strong></td><td>{contract.company_name||contract.full_name||contract.supplier_name||contract.partner_name||"—"}</td><td>{contract.amount?`${Number(contract.amount).toLocaleString("fr-FR")} ${contract.currency}`:"—"}</td><td>{contract.start_date||"—"} — {contract.end_date||"—"}</td><td>{contract.status}</td></tr>)}</tbody></table></div>
      </>}

      {tab==="invoices" && <>
        <div className="business-two-column">
          <form className="business-panel business-form" onSubmit={submitInvoice}>
            <h3>Émettre une facture</h3>
            <label>Client<select name="customerId" required>{customers.map((customer)=><option key={customer.id} value={customer.id}>{customer.company_name||customer.full_name}</option>)}</select></label>
            <label>Date d'émission<input name="issueDate" type="date" required /></label>
            <label>Échéance<input name="dueDate" type="date" required /></label>
            <label>Devise<select name="currency"><option value="USD">USD</option><option value="HTG">HTG</option></select></label>
            <label>Prestation<input name="description" required /></label>
            <label>Quantité<input name="quantity" type="number" min="0.001" step="0.001" defaultValue="1" required /></label>
            <label>Prix unitaire<input name="unitPrice" type="number" min="0" step="0.01" required /></label>
            <label>Réduction<input name="discount" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label>Taxes<input name="taxAmount" type="number" min="0" step="0.01" defaultValue="0" /></label>
            <label className="business-span-2">Contrat<select name="contractId"><option value="">Sans contrat</option>{contracts.filter((contract)=>contract.contract_kind==="client").map((contract)=><option key={contract.id} value={contract.id}>{contract.contract_number} · {contract.title}</option>)}</select></label>
            <label className="business-span-2">Notes<textarea name="notes" rows={2} /></label>
            <button className="button" type="submit">Émettre</button>
          </form>
          <form className="business-panel business-form" onSubmit={submitPayment}>
            <h3>Enregistrer un encaissement</h3>
            <label>Facture<select name="invoiceId" required>{invoices.map((invoice)=><option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · solde {Math.max(0,Number(invoice.total)-Number(invoice.paid)).toLocaleString("fr-FR")} {invoice.currency}</option>)}</select></label>
            <label>Montant<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Devise<select name="currency"><option value="USD">USD</option><option value="HTG">HTG</option></select></label>
            <label>Taux vers devise facture<input name="fxRate" type="number" min="0.00000001" step="0.00000001" defaultValue="1" /></label>
            <label>Méthode<select name="method"><option value="cash">Espèces</option><option value="bank_transfer">Virement</option><option value="cheque">Chèque</option><option value="mobile_money">Monnaie mobile</option><option value="card">Carte</option></select></label>
            <label>Date<input name="paidAt" type="date" required /></label>
            <label className="business-span-2">Référence<input name="reference" /></label>
            <button className="button" type="submit">Encaisser</button>
          </form>
        </div>
        <div className="business-panel table-scroll"><div className="panel-heading"><h3>Factures</h3><span className="count-pill">{invoices.length}</span></div><table><thead><tr><th>Numéro</th><th>Client</th><th>Émission</th><th>Échéance</th><th>Total</th><th>Payé</th><th>Solde</th><th>Statut</th></tr></thead><tbody>{invoices.map((invoice)=><tr key={invoice.id}><td><strong>{invoice.invoice_number}</strong></td><td>{invoice.company_name||invoice.full_name}</td><td>{invoice.issue_date}</td><td>{invoice.due_date}</td><td>{Number(invoice.total).toLocaleString("fr-FR")} {invoice.currency}</td><td>{Number(invoice.paid).toLocaleString("fr-FR")}</td><td>{Math.max(0,Number(invoice.total)-Number(invoice.paid)).toLocaleString("fr-FR")}</td><td>{invoice.status}</td></tr>)}</tbody></table></div>
      </>}

      {tab==="partners" && <>
        <div className="business-two-column">
          <form className="business-panel business-form" onSubmit={(event) => submit(event,"/api/v1/business/partners",{type:"supplier"})}><h3>Nouveau fournisseur</h3><label>Nom<input name="name" required /></label><label>Contact<input name="contactName" /></label><label>Email<input name="email" type="email" /></label><label>Téléphone<input name="phone" /></label><label className="business-span-2">Adresse<input name="address" /></label><label className="business-span-2">Conditions<input name="paymentTerms" /></label><button className="button" type="submit">Enregistrer</button></form>
          <form className="business-panel business-form" onSubmit={(event) => submit(event,"/api/v1/business/partners",{type:"partner"})}><h3>Nouveau partenaire</h3><label>Nom<input name="name" required /></label><label>Type<select name="partnerType"><option value="partner">Partenaire</option><option value="collaborator">Collaborateur</option><option value="sponsor">Sponsor</option><option value="other">Autre</option></select></label><label>Contact<input name="contactName" /></label><label>Email<input name="email" type="email" /></label><label className="business-span-2">Conditions<textarea name="commercialTerms" rows={2} /></label><button className="button" type="submit">Enregistrer</button></form>
        </div>
        <div className="business-panel table-scroll"><div className="panel-heading"><h3>Référentiel fournisseurs & partenaires</h3></div><table><thead><tr><th>Nom</th><th>Catégorie</th><th>Contact</th><th>Email</th><th>Statut</th></tr></thead><tbody>
          {data?.suppliers.map((supplier)=><tr key={`supplier-${supplier.id}`}><td><strong>{supplier.name}</strong></td><td>Fournisseur</td><td>{supplier.contact_name||"—"}</td><td>{supplier.email||"—"}</td><td>{supplier.is_active?"Actif":"Inactif"}</td></tr>)}
          {data?.partners.map((partner)=><tr key={`partner-${partner.id}`}><td><strong>{partner.name}</strong></td><td>{partner.partner_type}</td><td>{partner.contact_name||"—"}</td><td>{partner.email||"—"}</td><td>{partner.status}</td></tr>)}
        </tbody></table></div>
      </>}

      {tab==="reminders" && <>
        <form className="business-panel business-form" onSubmit={(event) => submit(event,"/api/v1/business/reminders",{})}>
          <h3>Planifier une relance</h3>
          <label>Affaire<select name="opportunityId" required>{opportunities.map((opportunity)=><option key={opportunity.id} value={opportunity.id}>{opportunity.title}</option>)}</select></label>
          <label>Date<input name="remindOn" type="date" required /></label>
          <label className="business-span-2">Note<input name="note" /></label>
          <button className="button" type="submit">Programmer</button>
        </form>
        <div className="business-panel table-scroll"><div className="panel-heading"><h3>Relances</h3></div><table><thead><tr><th>Date</th><th>Affaire</th><th>Note</th><th>Statut</th></tr></thead><tbody>{data?.reminders.map((reminder)=><tr key={reminder.id}><td>{reminder.remind_on}</td><td><strong>{reminder.title}</strong></td><td>{reminder.note||"—"}</td><td>{reminder.status}</td></tr>)}</tbody></table></div>
      </>}
    </section>
  );
}
