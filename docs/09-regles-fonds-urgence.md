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
- Le centre de rapports fournit la synthèse financière 6.7. La marge nette est
  `(revenus − dépenses) / revenus`, et reste vide si les revenus sont nuls.
  Trésorerie, fonds, budgets, créances et dettes sont présentés à la date de fin,
  par devise native sans conversion inter-devises. Seuls les budgets actifs
  approuvés sont comparés aux dépenses validées de leur période jusqu’à cette date;
  les conversions impossibles pour taux manquant restent signalées plutôt que
  présentées comme zéro. Les permissions propres à chaque source et entité
  filtrent les lignes. La synthèse est incluse à l’impression et dans un onglet
  dédié de l’export Excel.
- Recette QA du 2026-11-04 : le helper réel `createAutomaticFundContribution`,
  appelé deux fois sur le même revenu, a produit une contribution de 50,00 USD
  (taux approuvé de 5,00 %) et exactement un mouvement sortant et un entrant;
  le second appel a retourné `null`. Dans une transaction séparée, deux retraits
  synthétiques de 60,00 USD sur un solde de 100,00 USD ont donné une première
  approbation et un refus de la seconde après réservation du premier montant.
  Deux demandes de 60,00 USD au stade DG, après leur étape DAF, ont été
  approuvées simultanément depuis la session navigateur DG QA par les vrais
  endpoints `POST /api/v1/approvals/[id]` avec cookie de session : une réponse
  200 et une réponse 409 pour solde insuffisant. La base confirme qu’une seule
  demande réserve 60,00 USD. Les deux retraits, demandes d’approbation et
  notifications temporaires ont été supprimés par le propriétaire QA. Après
  nettoyage : solde 100,00 USD, un seul retrait historique contre-passé et
  aucune fixture/réservation active. Aucun changement sur `mojo_erp`; des traces
  d’audit append-only peuvent rester dans la base QA isolée.
- Le bouton d’export sur l’interface authentifiée a généré un Blob XLSX de
  4 338 octets. L’en-tête ZIP et `xl/workbook.xml` sont valides et exposent les
  onglets `Finance` et `Synthèse financière`. L’ouverture d’un fichier téléchargé
  dans Excel reste à confirmer.
- Cette implémentation est encore en cours de recette. La migration 023 est
  enregistrée sur la base QA isolée `mojo_erp_lot4_acceptance_20261101` et son
  schéma est vérifié. Augustin a accepté les Lots 4 et 5 le 2026-11-04; le Lot 6
  reste ouvert jusqu’à la fin des vérifications et son acceptation formelle.
  La connexion QA utilise un compte DG parallèle sur `127.0.0.1:3001`, distinct
  du cookie de `localhost:3000`; un défaut SQL du compteur de tentatives a été
  corrigé et les migrations 032/033 nécessaires à la session appliquées sur la
  QA seulement. La migration 034 relève du Lot 16 et exige un audit séparé de
  l’historique avant toute application.
  Ne pas appliquer les fixtures QA sur la base principale.
