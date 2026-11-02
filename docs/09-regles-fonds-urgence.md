# Livrable 9 — Règles financières du Fonds d'Urgence

1. **Propriétaire** : le fonds appartient entièrement à MoJoPIKtures (entité MOJO). MOJO Store n'a pas de fonds propre.
2. **Pourcentage configurable** : table `emergency_fund_rates` (historique). **Aucune valeur par défaut** (ni 5, 10 ni 15 %). Tant qu'aucun taux n'est défini, aucune contribution automatique n'est créée et un avertissement s'affiche à la DG.
3. **Modification du %** : demande de type `fund_rate` approuvée par la DG ; le nouveau taux a une `effective_from` et ne s'applique **jamais rétroactivement** aux contributions passées.
4. **Contribution automatique** : à la validation d'un revenu de MoJoPIKtures, le service calcule `montant × % en vigueur à la date du revenu` et crée une `fund_contributions` (liée au revenu, unique par revenu) ainsi que la transaction de virement vers le compte du fonds. Les revenus de MOJO Store ne sont pas concernés directement ; un reversement vers MoJoPIKtures qui est enregistré comme revenu l'est.
5. **Base de calcul confirmée par le propriétaire** : revenus d’exploitation validés de MoJoPIKtures. Les virements internes, apports et remboursements de prêts sont exclus. Les revenus de MOJO Store ne sont concernés qu’après leur reversement et leur enregistrement comme revenu de MoJoPIKtures.
6. **Contribution manuelle** possible (`kind = manual`), tracée et justifiée.
7. **Retrait** : demande (`fund_withdrawals`, montant, motif, justificatifs en `documents`) → DAF → DG → décaissement. Interdit si le montant dépasse le solde. Les justificatifs sont conservés (`documents`, confidentialité `finance`).
8. **Devises** : le fonds a une devise. Les montants soumis dans l’autre devise sont convertis au taux historique de la date d’opération saisie. Le taux de la transaction de décaissement est celui de sa date réelle d’enregistrement.
9. **Solde** = Σ contributions − Σ retraits décaissés (`v_fund_balance`). Le solde ne peut jamais devenir négatif (contrôlé en service dans une transaction SQL verrouillée).
10. **Objectif** : `target_amount` ; progression = solde / objectif affichée au dashboard ; alerte à l'atteinte.
11. **Rapport mensuel** : contributions, retraits, solde d'ouverture/clôture, progression, généré automatiquement (notification `monthly_report`).
12. **Immuabilité** : contributions et retraits ne se suppriment pas ; correction par écriture inverse, tout est audité. La contre-passation d’un revenu annule aussi sa contribution automatique liée; si le fonds ne dispose plus du montant à restituer, la contre-passation est bloquée.

## Avancement de l'implémentation

- Le paramétrage MOJO utilise un compte dédié actif, la devise du compte et un
  objectif facultatif. Le compte doit être vierge; son remplacement est bloqué
  dès qu’une contribution ou un retrait existe. Les changements sont audités par 022.
- Les taux sont proposés avec date d’effet et motif, puis approuvés par le workflow
  `fund_rate` de la DG. Les taux refusés restent auditables et ne bloquent pas une
  nouvelle proposition pour la même date. Seul un taux approuvé peut alimenter le
  calcul historique; sans taux, la validation du revenu est conservée et la DG est
  avertie sans créer de contribution.
- À la validation d’un revenu d’exploitation de MOJO, une contribution automatique
  unique calcule le taux approuvé à la date du revenu et inscrit les mouvements
  internes source/fonds atomiquement. Virements, écritures inverses, revenus du
  compte du fonds et motifs inter-entités apport/prêt/remboursement sont exclus.
  Les contributions manuelles enregistrent le motif, la date et la transaction.
- Les retraits exigent un justificatif, suivent DAF puis DG, réservent le solde
  disponible et ne peuvent être décaissés qu’après approbation complète. Le
  décaissement enregistre une dépense sur le compte du fonds avec le taux de sa
  date effective. Les justificatifs restent privés dans `documents`.
- Les contre-passations comptables ajustent aussi le registre du fonds. Un revenu
  déjà transféré au fonds ne peut être annulé que si le solde reste suffisant pour
  restituer le transfert; le retrait contre-passé restaure le solde. Les historiques
  et rapports tiennent compte de la date des contre-passations.
- L’écran Finance expose les taux, contributions, retraits et rapports mensuels,
  trimestriels et annuels. Le CSV est compatible tableur et protégé contre les
  formules; l’impression navigateur permet de produire un PDF. Des notifications
  in-app idempotentes signalent le rapport mensuel précédent et l’atteinte de
  l’objectif configuré.
- Cette implémentation est encore en cours de recette. La migration 023 est
  enregistrée sur la base QA isolée `mojo_erp_lot4_acceptance_20261101` et son
  schéma est vérifié. Ne pas appliquer les fixtures QA sur la base principale et
  conserver les Lots 4, 5 et 6 ouverts jusqu’à l’acceptation métier.
