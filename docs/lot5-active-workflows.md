# Lot 5 — workflows actifs

État lu en lecture seule dans `mojo_erp` le 2026-11-04, sous le rôle applicatif
`mojo_app`. Les étapes sont ordonnées; une étape sans seuil est toujours requise.
Une étape avec un seuil USD est requise lorsque le montant USD de la demande est
supérieur ou égal à ce seuil.

| Type | Workflow actif | Étapes et seuils configurés |
|---|---|---|
| `budget` | Approbation des budgets | DAF → DG |
| `contract` | Contrat | Responsable Affaires → DG |
| `expense` | Dépense exceptionnelle | DAF → DG à partir de 0,01 USD |
| `fund_rate` | Modification du pourcentage du fonds | DG |
| `fund_withdrawal` | Retrait du fonds d'urgence | DAF → DG |
| `leave` | Demande de congé | Responsable RH |
| `payroll` | Paie | DAF → DG |
| `project` | Projet | DG |
| `purchase` | Demande d'achat | Responsable Opérations → DAF → DG à partir de 0,01 USD |

La direction a fixé provisoirement le seuil DG des achats à 0,01 USD : tout
montant positif valide, exprimé au centime, atteint donc l'étape DG. Le même seuil
est actuellement configuré pour les dépenses exceptionnelles. Ne pas étendre cette
décision aux autres workflows.

Le fonctionnement immédiat du seuil d'achat a été exercé le 2026-11-04 sur la base
QA isolée : l'API d'administration a changé le seuil à 100,01 USD, puis l'a remis
à 0,01 USD; après chaque sauvegarde, le moteur a appliqué la nouvelle valeur. La
transaction QA a été annulée. La base principale n'a pas été modifiée pendant ce
test.

Le canal de notification retenu pour la recette est in-app. Le push web est
optionnel et reste désactivé; aucun délai d'escalade n'est ajouté sans décision
de la direction.
