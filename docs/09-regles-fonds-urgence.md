# Livrable 9 — Règles financières du Fonds d'Urgence

1. **Propriétaire** : le fonds appartient entièrement à MoJoPIKtures (entité MOJO). MOJO Store n'a pas de fonds propre.
2. **Pourcentage configurable** : table `emergency_fund_rates` (historique). **Aucune valeur par défaut** (ni 5, 10 ni 15 %). Tant qu'aucun taux n'est défini, aucune contribution automatique n'est créée et un avertissement s'affiche à la DG.
3. **Modification du %** : demande de type `fund_rate` approuvée par la DG ; le nouveau taux a une `effective_from` et ne s'applique **jamais rétroactivement** aux contributions passées.
4. **Contribution automatique** : à la validation d'un revenu de MoJoPIKtures, le service calcule `montant × % en vigueur à la date du revenu` et crée une `fund_contributions` (liée au revenu, unique par revenu) ainsi que la transaction de virement vers le compte du fonds. Les revenus de MOJO Store ne sont pas concernés directement ; un reversement vers MoJoPIKtures qui est enregistré comme revenu l'est.
5. **Base de calcul** (à confirmer) : revenus validés d'exploitation ; sont exclus les virements internes, apports et remboursements de prêt.
6. **Contribution manuelle** possible (`kind = manual`), tracée et justifiée.
7. **Retrait** : demande (`fund_withdrawals`, montant, motif, justificatifs en `documents`) → DAF → DG → décaissement. Interdit si le montant dépasse le solde. Les justificatifs sont conservés (`documents`, confidentialité `finance`).
8. **Devises** : le fonds a une devise ; une contribution/un retrait dans l'autre devise est converti au taux du jour saisi, le taux étant figé sur la transaction.
9. **Solde** = Σ contributions − Σ retraits décaissés (`v_fund_balance`). Le solde ne peut jamais devenir négatif (contrôlé en service dans une transaction SQL verrouillée).
10. **Objectif** : `target_amount` ; progression = solde / objectif affichée au dashboard ; alerte à l'atteinte.
11. **Rapport mensuel** : contributions, retraits, solde d'ouverture/clôture, progression, généré automatiquement (notification `monthly_report`).
12. **Immuabilité** : contributions et retraits ne se suppriment pas ; correction par écriture inverse, tout est audité.
