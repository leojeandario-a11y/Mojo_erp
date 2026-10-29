# Livrable 4 — Matrice des rôles et permissions

Généré depuis la base. ✓ = permission accordée. **SA (Super Administrator) possède la permission universelle `*`** (toutes les lignes). Les permissions sont contrôlées côté serveur (API + services) et, pour RH/salaires/documents, côté base (Row-Level Security).

Légende : **AFF** = Responsable Affaires, **ASS** = Assistant administratif, **CAI** = Caissier, **CPT** = Comptable, **DAF** = Responsable DAF, **DG** = Directeur Général, **RH** = Responsable RH, **MKT** = Responsable Marketing, **OPS** = Responsable Opérations, **PRJ** = Responsable projet, **USR** = Utilisateur standard, **STK** = Gestionnaire de stock, **SA** = Super Administrator

| Permission | AFF | ASS | CAI | CPT | DAF | DG | RH | MKT | OPS | PRJ | USR | STK | SA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `approvals.approve` | ✓ |  |  |  | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  | ✓ |
| `approvals.configure` |  |  |  |  |  | ✓ |  |  |  |  |  |  | ✓ |
| `audit.read` |  |  |  |  |  | ✓ |  |  |  |  |  |  | ✓ |
| `business.contract.manage` | ✓ |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| `business.contract.read` | ✓ |  |  |  |  | ✓ |  |  |  |  |  |  | ✓ |
| `business.customer.manage` | ✓ |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| `business.customer.read` | ✓ | ✓ |  |  |  | ✓ |  |  |  |  |  |  | ✓ |
| `business.invoice.manage` | ✓ |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| `business.invoice.read` | ✓ |  |  | ✓ | ✓ | ✓ |  |  |  |  |  |  | ✓ |
| `business.opportunity.manage` | ✓ |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| `business.payment.record` |  |  |  | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |
| `business.report.read` | ✓ |  |  |  |  | ✓ |  |  |  |  |  |  | ✓ |
| `dashboard.department.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `dashboard.global.read` |  |  |  |  |  | ✓ |  |  |  |  |  |  | ✓ |
| `documents.manage` |  | ✓ |  |  |  |  | ✓ |  |  |  |  |  | ✓ |
| `documents.read` | ✓ | ✓ |  |  | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ |
| `finance.account.manage` |  |  |  |  | ✓ |  |  |  |  |  |  |  | ✓ |
| `finance.budget.manage` |  |  |  |  | ✓ |  |  |  |  |  |  |  | ✓ |
| `finance.budget.read` |  |  |  | ✓ | ✓ | ✓ |  | ✓ | ✓ |  |  |  | ✓ |
| `finance.fund.approve_withdrawal` |  |  |  |  |  | ✓ |  |  |  |  |  |  | ✓ |
| `finance.fund.contribute` |  |  |  |  | ✓ |  |  |  |  |  |  |  | ✓ |
| `finance.fund.read` |  |  |  | ✓ | ✓ | ✓ |  |  |  |  |  |  | ✓ |
| `finance.fund.request_withdrawal` |  |  |  |  | ✓ |  |  |  |  |  |  |  | ✓ |
| `finance.fund.set_rate` |  |  |  |  |  | ✓ |  |  |  |  |  |  | ✓ |
| `finance.rate.manage` |  |  |  |  | ✓ |  |  |  |  |  |  |  | ✓ |
| `finance.report.read` |  |  |  | ✓ | ✓ | ✓ |  |  |  |  |  |  | ✓ |
| `finance.transaction.create` |  |  |  | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |
| `finance.transaction.read` |  |  |  | ✓ | ✓ | ✓ |  |  |  |  |  |  | ✓ |
| `finance.transaction.reverse` |  |  |  |  | ✓ |  |  |  |  |  |  |  | ✓ |
| `finance.transaction.validate` |  |  |  |  | ✓ | ✓ |  |  |  |  |  |  | ✓ |
| `hr.attendance.manage` |  |  |  |  |  |  | ✓ |  |  |  |  |  | ✓ |
| `hr.employee.manage` |  |  |  |  |  |  | ✓ |  |  |  |  |  | ✓ |
| `hr.employee.read` |  |  |  |  |  | ✓ | ✓ |  |  |  |  |  | ✓ |
| `hr.leave.approve` |  |  |  |  |  | ✓ | ✓ |  |  |  |  |  | ✓ |
| `hr.leave.request` |  | ✓ |  |  |  |  | ✓ |  |  |  | ✓ |  | ✓ |
| `hr.recruitment.manage` |  |  |  |  |  |  | ✓ |  |  |  |  |  | ✓ |
| `hr.report.read` |  |  |  |  |  | ✓ | ✓ |  |  |  |  |  | ✓ |
| `hr.salary.manage` |  |  |  |  |  |  | ✓ |  |  |  |  |  | ✓ |
| `hr.salary.read` |  |  |  |  | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ |
| `marketing.campaign.manage` |  |  |  |  |  |  |  | ✓ |  |  |  |  | ✓ |
| `marketing.campaign.read` |  |  |  |  |  | ✓ |  | ✓ |  |  |  |  | ✓ |
| `marketing.content.manage` |  |  |  |  |  |  |  | ✓ |  |  |  |  | ✓ |
| `marketing.report.read` |  |  |  |  |  | ✓ |  | ✓ |  |  |  |  | ✓ |
| `operations.project.manage` |  |  |  |  |  |  |  |  | ✓ | ✓ |  |  | ✓ |
| `operations.project.read` |  |  |  |  |  | ✓ |  |  | ✓ | ✓ |  |  | ✓ |
| `operations.report.read` |  |  |  |  |  | ✓ |  |  | ✓ |  |  |  | ✓ |
| `operations.task.manage` |  |  |  |  |  |  |  |  | ✓ | ✓ |  |  | ✓ |
| `reports.export` |  |  |  | ✓ | ✓ | ✓ |  |  |  |  |  |  | ✓ |
| `settings.config.manage` |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| `settings.roles.manage` |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| `settings.users.manage` |  |  |  |  |  |  |  |  |  |  |  |  | ✓ |
| `store.exhibitor.manage` |  |  |  |  |  |  |  |  | ✓ |  |  |  | ✓ |
| `store.finance.read` |  |  |  |  | ✓ | ✓ |  |  |  |  |  |  | ✓ |
| `store.pos.sell` |  |  | ✓ |  |  |  |  |  |  |  |  |  | ✓ |
| `store.product.manage` |  |  |  |  |  |  |  |  |  |  |  | ✓ | ✓ |
| `store.product.read` |  |  | ✓ |  |  | ✓ |  |  | ✓ |  |  | ✓ | ✓ |
| `store.report.read` |  |  |  |  | ✓ | ✓ |  |  | ✓ |  |  |  | ✓ |
| `store.stock.manage` |  |  |  |  |  |  |  |  | ✓ |  |  | ✓ | ✓ |

## Règles complémentaires

- Les rôles personnalisés peuvent être créés et les rôles existants modifiés depuis l'administration (`settings.roles.manage`) ; chaque modification est auditée. `super_admin` est immuable, `*` lui est réservé et un acteur ne peut pas attribuer une permission qu’il ne détient pas.
- Un utilisateur peut cumuler plusieurs rôles et affecter un rôle à plusieurs portées ; `user_roles.entity_id` distingue les rôles globaux des rôles limités à MoJoPIKtures ou MOJO Store. Les autorisations de base sans entité ne reconnaissent que les rôles globaux. Les endpoints métier doivent vérifier l’entité cible explicitement.
- **Séparation des tâches** : celui qui crée une dépense ne peut pas la valider lui-même (contrôlé dans le service d'approbation).
- Le **DAF** voit les salaires (`hr.salary.read`) pour la paie mais n'a pas `finance.fund.set_rate` ni `finance.fund.approve_withdrawal` : ces décisions relèvent de la DG.
- Les données RH/salaires ont un niveau de confidentialité supérieur (RLS) : sans permission, la base renvoie zéro ligne, même en cas de faille côté interface.
