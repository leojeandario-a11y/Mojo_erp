# Livrable 8 — Wireframes des écrans principaux (ASCII)

## Structure commune (desktop)
```text
┌────────────────────────────────────────────────────────────────────────────┐
│ ☰  MoJoPIKtures      🔍 Recherche globale        [HTG|USD] [FR▾] 🔔3  👤   │
├───────────────┬────────────────────────────────────────────────────────────┤
│ ▌Dashboard    │  Accueil › Dashboard                                        │
│ ▌Direction Gén│  Période: [Ce mois ▾]  Entité: [Toutes ▾]                   │
│ ▌Finance      │ ┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐    │
│ ▌RH           │ │CA       ││Dépenses ││Résultat ││Trésorerie││Fonds urg│    │
│ ▌Affaires     │ │ 0       ││ 0       ││ 0       ││ 0        ││ 0 / obj │    │
│ ▌Marketing    │ └─────────┘└─────────┘└─────────┘└─────────┘└─────────┘    │
│ ▌Opérations   │ ┌──────────────────────────┐┌──────────────────────────┐   │
│ ▌Projets      │ │ Revenus vs Dépenses (mois)││ Dépenses par direction   │   │
│ ▌MOJO Store   │ └──────────────────────────┘└──────────────────────────┘   │
│ ▌Approbations │ ┌──────────────────────────┐┌──────────────────────────┐   │
│ ▌Rapports     │ │ Ventes MOJO Store        ││ Évolution fonds d'urgence│   │
│ ▌Paramètres   │ └──────────────────────────┘└──────────────────────────┘   │
└───────────────┴────────────────────────────────────────────────────────────┘
```
## Saisie d'une dépense
```text
Finance › Transactions › Nouvelle dépense
Date [____]  Compte [Caisse HTG ▾]  Catégorie [____▾]  Direction [____▾]  Projet [____▾]
Montant [_______] Devise [HTG|USD]   Taux appliqué: 1 USD = [___] HTG (taux du jour)
Description [________________]  Justificatif [Téléverser]
≈ équivalent: ___ USD                     [Enregistrer brouillon] [Soumettre]
```
## Fonds d'urgence
```text
Solde: ████████░░░░  62% de l'objectif      Pourcentage en vigueur: [ __ % ] depuis __/__/__  [Modifier → approbation DG]
[Contributions] [Retraits] [Demandes] [Rapport mensuel]
Date | Revenu source | % | Montant | Statut        [+ Demander un retrait]
```
## Approbation (mobile)
```text
┌──────────────────────┐
│ Demande d'achat      │
│ Resp. Ops · 450 USD  │
│ Étape 2/3 : DAF      │
│ [Pièces jointes]     │
│ [✔ Approuver] [✖ Refuser] │
│ Commentaire [______] │
└──────────────────────┘
```
## Pipeline Affaires (kanban)
```text
Prospect │ Contact │ Proposition │ Négociation │ Contrat │ Client │ Livraison │ Paiement
 [carte] │ [carte] │   [carte]   │   [carte]   │ [carte] │ [carte]│  [carte]  │ [carte]
```
## POS (MOJO Store)
```text
┌ Recherche / scan code-barres ─────────┐ ┌ Panier ──────────────────┐
│ [produit][produit][produit][produit]  │ │ Produit  Qté  Prix  Total│
│ [produit][produit][produit][produit]  │ │ Réduction: [___]         │
└───────────────────────────────────────┘ │ TOTAL: ____ [HTG|USD]    │
 Client [____▾]  Paiement [Espèces▾]       │ [Encaisser] [Reçu]      │
                                           └──────────────────────────┘
```
