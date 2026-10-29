# Livrable 1 — Architecture du système

## Décisions validées
| Sujet | Décision |
|---|---|
| Application | Web responsive + PWA (installable), évolutive vers mobile natif |
| Frontend | Next.js (App Router) + TypeScript |
| Backend | API Next.js (route handlers) + couche de services métier |
| Base | PostgreSQL 16, Row-Level Security sur RH/salaires/documents |
| Devises | HTG et USD ; taux de change saisi manuellement ; chaque utilisateur bascule l'affichage |
| Solde initial des comptes | Nouveau compte à 0 par défaut, modifiable ensuite (choix du propriétaire, 2026-10-24) |
| Numérotation des transactions | Automatique par entité et année civile, format `CODE-AAAA-000001` (choix du propriétaire, 2026-10-24) |
| Langues | Français, Kreyòl, Anglais (par utilisateur) |
| Comptabilité | Suivi revenus/dépenses (pas de partie double) |
| Hébergement | Serveur local (Docker) puis cloud |
| MOJO Store | Entité financière distincte (caisses, comptes, rapports propres) |
| Fonds d'urgence | Appartient à MoJoPIKtures ; pourcentage configurable |

## Couches
1. **Client (PWA)** : pages Next.js, service worker, installation, notifications push.
2. **API** `/api/v1/*` : authentification → permission → validation (Zod) → service → réponse. Aucune logique métier ici.
3. **Services métier** `src/modules/<module>/service` : règles financières, approbations, fonds d'urgence, stock. Seule couche qui écrit en base.
4. **Accès données** (Prisma ou Drizzle) : transactions SQL pour toute opération financière ; chaque requête exécute `SET LOCAL app.user_id/app.ip` pour que l'audit et la RLS identifient l'utilisateur.
5. **PostgreSQL** : contraintes, triggers (audit, immutabilité), RLS, vues de solde.
6. **Services annexes** : stockage de fichiers (disque puis S3), tâches planifiées (`pg-boss`), génération PDF/Excel.

## Contrôle d'accès en trois niveaux
Route API (permission) → service (règles métier, séparation des tâches) → base (RLS + droits du rôle `mojo_app`, qui ne peut ni modifier `audit_logs` ni supprimer des transactions).

## Multi-devises
- Chaque transaction stocke `amount`, `currency` et `fx_rate_to_usd` (taux figé à la saisie) ; `amount_usd` est calculé par la base.
- Le dashboard convertit à l'affichage selon la préférence de l'utilisateur (HTG/USD) avec le taux le plus récent saisi à la date concernée ; si aucun taux n'existe pour une date, le système utilise le dernier taux antérieur et l'indique.
- Les taux sont saisis manuellement (`finance.rate.manage`), historisés et audités.

## Multi-entités
`entities` : MOJO (MoJoPIKtures) et STORE (MOJO Store, filiale logique). Comptes, transactions, budgets et rapports portent un `entity_id`. Les flux entre les deux passent par `inter_entity_transfers` (apport, reversement de bénéfices, prêt) et créent deux transactions liées. La DG consulte la vue consolidée.

Les affectations de rôles peuvent être globales (`user_roles.entity_id IS NULL`) ou limitées à une entité. Les vérifications globales ignorent les rôles limités; les services qui lisent ou écrivent des données métier par entité doivent utiliser `app_has_entity_permission(permission, entity_id)` en base et l’équivalent `hasEntityPermission` côté serveur.

## Règles transversales
- Transactions validées **immuables** (trigger) : correction par contre-passation (`reversal_of_id`).
- Audit automatique par trigger sur les tables sensibles + événements applicatifs (connexion, approbation).
- Aucun paramètre métier codé en dur : pourcentage du fonds, seuils, workflows, devises, taux sont en base.
- i18n : `messages/fr.json`, `ht.json`, `en.json`.

## Déploiement
Docker Compose : `db` (PostgreSQL), `migrate` (applique les migrations), `app` (Next.js, à partir de la Phase 1 code), `backup` (dump quotidien). Même image pour serveur local et cloud.

## Ambiguïtés identifiées et corrections proposées
| # | Point | Proposition |
|---|---|---|
| 1 | Salaire visible du DAF ? | Oui en lecture pour la paie ; modification réservée au RH (modifiable en rôles) |
| 2 | Seuils d'approbation DG | Valeurs initiales volontairement basses (0,01 USD = DG toujours) ; **à définir par la direction** avant production |
| 3 | % du fonds d'urgence | Aucune valeur initiale ; tant que la direction n'en a pas fixé un, aucune contribution automatique |
| 4 | Contribution au fonds : sur revenus bruts ou nets ? | Par défaut sur les revenus validés de MoJoPIKtures ; base de calcul modifiable (voir livrable 9) |
| 5 | Retraits en devise différente du fonds | Conversion au taux du jour saisi, montant suivi dans la devise du fonds |
| 6 | Ventes Store à crédit | Option `credit` prévue ; créances Store suivies séparément |
| 7 | Droit du travail haïtien / paie | Structure fournie ; règles (cotisations, congés légaux) à valider avec un juriste/comptable |
| 8 | Hors-ligne du POS | Prévu en phase 7 (file locale + synchronisation) ; non inclus dans la fondation |
