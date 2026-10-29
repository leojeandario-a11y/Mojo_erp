# Livrable 6 — Arborescence de l'application

```text
mojo-erp/
├── docker-compose.yml          ├── .env.example           ├── README.md
├── db/migrations/              (001 → 009, SQL)
├── scripts/                    (migrate.sh, backup.sh, generate_docs.py)
├── messages/                   fr.json · ht.json · en.json
├── public/                     manifest.webmanifest, icônes, service worker
└── src/
    ├── app/
    │   ├── (auth)/             login · mot-de-passe-oublié · réinitialisation
    │   ├── (app)/
    │   │   ├── dashboard/      global · direction
    │   │   ├── direction-generale/   vue DG, approbations, performance par direction
    │   │   ├── finance/        transactions · comptes · caisse · budgets · fonds-urgence · paiements · dettes · taux-de-change
    │   │   ├── hr/             employés · présences · congés · évaluations · formations · recrutement · paie
    │   │   ├── business/       clients · prospects · pipeline · contrats · partenaires · fournisseurs · factures
    │   │   ├── marketing/      campagnes · contenu · calendrier · résultats
    │   │   ├── operations/     activités · tâches · ressources
    │   │   ├── projects/       liste · détail · budget · documents
    │   │   ├── store/          pos · produits · stock · inventaire · ventes · exposants · finance-store
    │   │   ├── approvals/      à traiter · mes demandes · historique
    │   │   ├── notifications/
    │   │   ├── reports/        centre de rapports
    │   │   └── settings/       utilisateurs · rôles · workflows · devises · paramètres · audit · sauvegardes
    │   └── api/v1/             auth · finance · hr · business · marketing · operations · store · approvals · reports · settings
    ├── modules/<module>/       service/ · schemas/ (Zod) · queries/ · types.ts
    ├── core/                   auth · rbac · approvals · notifications · audit · documents · i18n · config · fx
    ├── components/             layout (Sidebar, Topbar) · ui · charts · tables · forms
    ├── db/                     client, transactions, contexte utilisateur (SET LOCAL)
    └── lib/                    money · dates · validation · pdf · excel
```
