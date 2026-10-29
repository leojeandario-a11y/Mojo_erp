# Livrable 10 — Plan de développement par sprint (2 semaines)

| Sprint | Contenu | Résultat vérifiable |
|---|---|---|
| 0 | Conception, schéma SQL, Docker, installation (**livré**) | Base validée, documents 1–10 |
| 1 | Phase 1 : projet Next.js/TS, connexion à la base, auth (sessions, verrouillage), contexte utilisateur `SET LOCAL`, i18n FR/Kreyòl/EN, layout (sidebar/topbar), PWA de base | Se connecter, changer langue/devise |
| 2 | Phase 1 : utilisateurs, rôles, permissions, directions, audit viewer, dashboard de base | RBAC testé (serveur + base) |
| 3 | Phase 2 : taux de change, comptes, caisse, transactions, contre-passation | Solde correct HTG/USD |
| 4 | Phase 2 : budgets, moteur d'approbation, notifications | Dépense approuvée par workflow |
| 5 | Phase 2 : fonds d'urgence, rapports financiers | Contribution auto + retrait approuvé |
| 6–7 | Phase 3 : employés, congés, présences, paie, documents | Salaires invisibles sans permission |
| 8–9 | Phase 4 : clients, pipeline, contrats, factures, encaissements | Pipeline → facture → paiement |
| 10 | Phase 5 : marketing | Budget vs dépenses vs résultats |
| 11 | Phase 6 : projets, tâches, ressources | Suivi budget/progression |
| 12–14 | Phase 7 : MOJO Store (produits, stock, POS, exposants, finance Store) | Vente → stock → caisse Store |
| 15–16 | Phase 8 : dashboard avancé, centre de rapports, PDF/Excel | Exports conformes |
| 17–18 | Phase 9 : tests permissions/finance/mobile/charge, audit sécurité, backup/restauration, mise en production | Checklist de recette signée |

Chaque module suit les 12 étapes de la méthode (besoins → règles → base → API → interface → permissions → validations → audit → tests → données réalistes → corrections → validation).

## État de la Phase 1

Le socle Next.js/TypeScript, la connexion à PostgreSQL, les sessions avec verrouillage, le contexte `SET LOCAL`, le changement de langue/devise, la navigation, le dashboard initial, la gestion des utilisateurs/rôles, le journal d’audit, le déploiement Docker et le parcours de réinitialisation du mot de passe sont en place. La récupération par e-mail nécessite la configuration d’un transport SMTP dans l’environnement. Depuis, les Lots 4 (Finance) et 5 (budgets et premier workflow d’approbation des dépenses) ont avancé; le Lot 4 reste ouvert et non validé, et les livraisons du Lot 5 attendent encore leur recette authentifiée. Voir [`INSTRUCTION.md`](../INSTRUCTION.md) pour l’état courant et le journal détaillé.
