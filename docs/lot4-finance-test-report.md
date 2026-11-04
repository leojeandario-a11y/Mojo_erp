# Lot 4 — rapport de recette technique Finance

**État :** critères techniques acceptés par Augustin le 2026-11-04.  
**Base de recette :** `mojo_erp_lot4_acceptance_20261101`, isolée de `mojo_erp`.  
**Exécution DB/API/UI documentée :** 2026-11-01.  
**Revue des critères et régression du dépôt :** 2026-11-04.

Ce rapport synthétise les résultats consignés dans [`INSTRUCTION.md`](../INSTRUCTION.md).
Les journaux bruts des 73 contrôles API/DB ne sont pas inclus dans le dépôt; les
résultats détaillés ci-dessous ne prétendent pas remplacer ces journaux.

## Critères et résultats

| Étape | Résultat technique documenté |
|---|---|
| 4.1 — Taux | Taux manuel daté, historique, correction d'une paire/date et rappel si aucun taux du jour. Le taux de conversion est figé sur la transaction. |
| 4.2 — Comptes | Comptes par entité/devise, solde initial et consultation des soldes vérifiés. |
| 4.3 — Catégories | Hiérarchie et périmètre d'entité vérifiés. Le 2026-11-02, la direction a confirmé les dépenses **Salaire Employeur, Loyer, Fournitures, Transport** et la recette **Ventes**; elles ont été configurées sur les entités actives principales. |
| 4.4 — Transactions | Revenus, dépenses, ajustements, numérotation et justificatifs privés vérifiés. Les contrôles incluaient types/formats, taille, accès propriétaire et téléchargement des justificatifs. |
| 4.5–4.7 — Cycle, séparation des tâches, contre-passation | Brouillon, approbation/refus, immutabilité et écriture inverse liée vérifiés. Le créateur ne peut pas valider son écriture; l'originale et la contre-passation sont comptabilisées selon leur état. |
| 4.8 — Transferts | Les deux écritures liées d'un transfert entre comptes de même entité/devise et leur validation ont été vérifiées. |
| 4.9 — Caisse | Ouverture, comptage, clôture, plafond et tolérance testés; les opérations hors limites sont refusées. |
| 4.10 — Paiements et dettes | Paiements, remboursements partiels, réservations, soldes restants et refus d'un sur-remboursement vérifiés. |
| 4.11 — Recherche, export et mobile | Filtres/recherche, export CSV téléchargeable, écran Finance et ajout rapide mobile vérifiés. |
| 4.12 — Exactitude et concurrence | À 1 USD = 140 HTG, 500 USD + 20 000 HTG donnent 642,86 USD ou 90 000,00 HTG. Cinquante opérations équilibrées ont laissé le solde à 1 000,00 USD. La validation simultanée d'un même brouillon a produit un succès puis un conflit; les modifications/suppressions d'écritures validées sont bloquées. |

La recette isolée du 2026-11-01 est documentée comme couvrant 73 contrôles API/DB.
Le typecheck, ESLint, le build webpack de production et 14 tests automatisés
passaient lors de cette recette. Lors de la revue du 2026-11-04, la suite courante
du dépôt a passé 36/36 tests, avec `npm run typecheck`, `npm run lint` et
`git diff --check`.

## Limites et livraison

- Aucun scénario de recette n'a été exécuté sur la base de production `mojo_erp`;
  aucune donnée métier n'y a été écrite pour cette recette.
- L'acceptation formelle des critères du lot a été donnée par Augustin le 2026-11-04.
- L'archive de livraison `mojo-erp-lot4.zip` n'est pas produite par ce rapport;
  le code est maintenu dans le dépôt et les données de recette restent dans la base
  QA isolée.
- La base QA existante est détenue par `postgres`; son nettoyage requiert un rôle
  propriétaire. Ne pas essayer de la supprimer avec `mojo_app`.
