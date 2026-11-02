# MoJo ERP — Plateforme de gestion intégrée MoJoPIKtures

**État : Lot 4 (Finance) ouvert/non validé; Lot 5 en cours.**
La conception et la base du Sprint 0 sont livrées. Le socle Next.js comprend l’authentification, les préférences, le tableau de bord et l’administration. Les fonctions Finance ont été testées fictivement, mais les critères métier et l’acceptation du Lot 4 restent à compléter. Le propriétaire a autorisé le démarrage du Lot 5 en parallèle, sans valider le Lot 4.

## Contenu du projet

| Élément | Emplacement |
|---|---|
| Architecture, ERD, règles et plan | `docs/` |
| État du projet et guide de reprise | [`INSTRUCTION.md`](./INSTRUCTION.md) |
| Schéma PostgreSQL (84 tables, 5 vues) | `db/migrations/` |
| Application Next.js / TypeScript | `src/` |
| Logos MoJoPIKtures transparents, manifeste et service worker PWA | `public/` |
| Docker Compose et image applicative | `docker-compose.yml`, `Dockerfile` |
| Scripts (migration, admin, sauvegarde, restauration) | `scripts/` |

La base garantit notamment l’immutabilité des transactions validées, un journal d’audit en ajout seul et la protection RLS des données RH, de paie et des documents confidentiels.

## Installation — Docker (recommandée)

Prérequis : Docker et Docker Compose.

```bash
cp .env.example .env
# Dans .env, définissez POSTGRES_PASSWORD et APP_DB_PASSWORD comme deux
# mots de passe longs, différents et propres à cet environnement.
# Les variables PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD permettent
# aussi de démarrer l’application localement sans conteneur.
# Si le port local 5432 est déjà utilisé, exportez DB_HOST_PORT=5433.
docker compose up -d db
docker compose run --rm migrate
```

Créez l’identifiant de connexion du premier administrateur. L’identifiant sera son **adresse e-mail**; choisissez aussi son nom complet. Depuis le dossier du projet, copiez le script dans le conteneur de base :

```bash
DB_HOST_PORT=5433 docker compose --env-file .env.example exec -T db sh -c 'cat > /tmp/create_admin.sh' < scripts/create_admin.sh
DB_HOST_PORT=5433 docker compose --env-file .env.example exec -it db sh -c \
  'PGHOST=localhost PGPORT=5432 PGUSER="$POSTGRES_USER" PGDATABASE="$POSTGRES_DB" PGPASSWORD="$POSTGRES_PASSWORD" bash /tmp/create_admin.sh "votre-adresse@domaine.com" "Votre nom complet"'
```

Remplacez l’adresse et le nom par les vôtres. La seconde commande demande le mot de passe dans le terminal sans l’afficher; il doit contenir au moins 12 caractères. Ne saisissez pas le mot de passe dans le chat. Ce premier compte reçoit le rôle Super Administrator et peut ensuite créer les autres comptes depuis **Administration → Utilisateurs**.

Démarrez l’application :

```bash
docker compose up -d app
```

Ouvrez `http://localhost:3000`. L’application se connecte avec le compte limité `mojo_app`, jamais avec le propriétaire de la base.

## Récupération du mot de passe

La page **Mot de passe oublié** envoie un lien à usage unique valable une heure. Pour Brevo, configurez dans `.env` :

```dotenv
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<identifiant SMTP affiché dans Brevo>
SMTP_PASSWORD=<clé SMTP générée dans Brevo, pas la clé API>
SMTP_FROM=<adresse d’expéditeur vérifiée dans Brevo>
APP_BASE_URL=http://localhost:3000
```

`SMTP_USER` est l’identifiant SMTP de la section **SMTP & API** de Brevo, et `SMTP_PASSWORD` est une clé SMTP générée dans ce compte. L’adresse `SMTP_FROM` doit être validée dans Brevo. Ne communiquez pas ces identifiants dans le chat et ne les versionnez pas. Après les avoir ajoutés au fichier local `.env`, recréez le conteneur applicatif :

```bash
docker compose up -d --build app
```

Un Super Administrator peut aussi générer un lien unique valable une heure depuis **Administration → Utilisateurs** et le transmettre à l’utilisateur par un canal sûr. Le lien apparaît une seule fois dans l’interface; traitez-le comme un secret. Ce mécanisme ne dépend pas de SMTP, contrairement à la demande de réinitialisation par e-mail.

## Administration (Lot 3)

- **Utilisateurs** : affectez chaque rôle globalement ou à une entité; les permissions liées à une entité doivent être vérifiées avec l’entité cible dans les services métier.
- **Rôles et permissions** : créez un rôle personnalisé, puis limitez-le aux permissions que vous détenez. Le rôle `super_admin` et la permission universelle `*` sont protégés.
- **Directions** : gérez leurs codes, couleurs, responsables et état actif.
- **Configuration** : les paramètres exposés incluent les devises par défaut, le mois d’ouverture de l’exercice, la durée des nouvelles sessions et le seuil de verrouillage. Toute modification est auditée.
- **Journal d’audit** : filtrez par période, acteur, module, action et résultat, puis exportez jusqu’à 10 000 événements en CSV.

## Finance (Lot 4 — en cours)

- **Comptes** : gérez les comptes par entité (caisse, banque, argent mobile ou autre), en HTG ou USD. Le solde initial démarre à 0 et peut être modifié ensuite; les changements sont audités. Les numéros enregistrés dans l’interface sont des numéros masqués.
- **Taux de change** : les utilisateurs autorisés saisissent manuellement un taux et sa date d’effet. Une correction sur la même date et la même paire de devises remplace l’entrée précédente avec une trace d’audit.
- **Transactions** : les revenus et dépenses sont créés comme brouillons et numérotés automatiquement par entité et année civile (par exemple `MOJO-2026-000001`). La validation est réservée à un autre utilisateur autorisé; le taux de conversion USD est figé à la date choisie.
- **Contre-passation** : crée une écriture inverse en brouillon à une date et avec un motif explicitement saisis. L’originale reste validée jusqu’à la validation indépendante du brouillon inverse; alors les deux changements d’état sont enregistrés atomiquement. Une seule contre-passation est permise par écriture originale.
- **Caisse et transferts** : ouverture/clôture quotidienne par compte caisse, contrôles configurables de plafond et tolérance d’écart, transferts entre comptes de même entité/devise enregistrés comme deux transactions liées et validés ensemble.
- **Catégories** : référentiel configurable par entité; aucune liste métier prédéfinie n’est imposée.
- **Paiements et dettes** : un paiement/encaissement crée une transaction liée en brouillon. La dette sert au suivi du solde; chaque remboursement crée une dépense brouillon liée, réserve son montant et ne réduit le solde qu’après validation.
- **Recherche et export** : filtre des transactions par période, type, état et recherche (numéro, description, entité, compte ou catégorie); export CSV filtré jusqu’à 10 000 lignes.
- **Ajustements** : création avec montant positif et sens explicite (augmentation ou diminution du solde); l’écriture inverse conserve le montant et inverse le sens.
- **Justificatifs Finance en local** : PDF, JPEG et PNG de 10 Mo maximum sont enregistrés hors du dépôt et du répertoire public dans `%USERPROFILE%\.mojo-erp\private-finance-documents`. Le créateur peut joindre un fichier à son brouillon; la lecture exige la permission Finance de l’entité ou l’appartenance au brouillon. `FINANCE_DOCUMENTS_DIR` peut remplacer le chemin local. Ce stockage n’est pas synchronisé vers le cloud; choisir et configurer le fournisseur avant un déploiement hébergé.
- Tests fictifs API authentifiés en base temporaire : comptes/catégories, approbation indépendante, immutabilité et contre-passation, conversion HTG/USD, paiements, seuils de caisse, transferts, dette et remboursements, filtres/CSV et solde après 50 opérations. Parcours visuel desktop/mobile sur l’interface Finance : création de compte et catégorie, paiement/encaissement, dette/remboursement brouillon, ouverture/clôture de caisse, transfert brouillon, création/filtrage d’une transaction et affichage dans les historiques. Le contrôle navigateur du code de catégorie est corrigé pour la syntaxe RegExp moderne. Une migration corrective 016 permet la validation des contre-passations sans comparer la colonne générée `amount_usd`.
- La validation métier, la recette complète des écrans et l’acceptation du Lot 4 restent à faire. Les seuils restent configurables et doivent être renseignés compte par compte avant les opérations de caisse.

## Budgets, approbations et notifications (Lot 5)

- Les budgets sont annuels ou mensuels, avec lignes par catégorie/libellé, devise et seuil d’alerte configurable. Les périmètres disponibles sont l’entité, une direction, un projet, des catégories, Marketing (`MKT`), Opérations (`OPS`) et Ressources humaines (`DRH`). Les périmètres par module rapprochent les transactions affectées à la direction correspondante.
- Le suivi compare les dépenses validées de la période au budget dans sa devise. Les montants HTG/USD utilisent le taux historique de chaque transaction; si un taux requis manque, le total réel est déclaré indisponible plutôt que partiel.
- Les workflows actifs et leurs étapes, rôles/utilisateurs approbateurs et seuils USD se configurent sous `/settings/approval-workflows`. Les files proposent « À traiter », « Mes demandes » et « Historique ». Les parcours branchés sont les dépenses, demandes d’achat et budgets; le workflow de budget est initialisé DAF puis DG, sans seuil monétaire imposé. Les règles définitives restent modifiables depuis l’administration.
- L’approbateur ne peut pas décider sur sa propre demande et doit être assigné à l’étape courante et autorisé sur l’entité. Les décisions sont auditées. La dépense approuvée attend encore sa validation comptable; le refus la rejette. Le renvoi au demandeur est actuellement disponible seulement pour les dépenses.
- Le centre in-app gère le badge, la liste et le marquage comme lu. Les tâches planifiées créent des rappels idempotents pour factures en retard, paiements attendus, contrats arrivant à échéance, seuils budgétaires atteints et projets en retard. Configurez `MOJO_SCHEDULED_TASK_TOKEN` avec un secret privé d’au moins 32 caractères et, si nécessaire, `MOJO_SCHEDULED_REMINDER_WINDOW_DAYS` (0–30, défaut 7). Appelez quotidiennement `scripts/run_scheduled_notifications.ps1` depuis le Planificateur de tâches Windows avec le token transmis dans l’environnement du processus.
- Le push web est optionnel. Pour l’activer, configurez ensemble `MOJO_WEB_PUSH_PUBLIC_KEY`, `MOJO_WEB_PUSH_PRIVATE_KEY` et `MOJO_WEB_PUSH_SUBJECT` dans l’environnement serveur; ne versionnez jamais la clé privée. Le navigateur doit être sur HTTPS (ou localhost). L’envoi utilise une file avec reprises et suppression des abonnements expirés.
- Migration `021_lot5_budget_schedule_push.sql` requise avant d’utiliser soumission de budgets, rappels et push. Les validations automatisées, typecheck, lint et build ne remplacent pas les tests de workflows complets, seuils limites et droits avec des comptes séparés en base isolée. Aucun test métier n’a été exécuté sur la base `mojo_erp`; le Lot 5 reste à valider par Augustin.

Utilisez une URL absolue pour `APP_BASE_URL`. En production, elle doit utiliser HTTPS; HTTP est accepté uniquement pour les adresses locales `localhost`, `127.0.0.1` ou `::1`. `SMTP_USER` et `SMTP_PASSWORD` doivent être définis ensemble. Sans identifiants ou adresse d’expéditeur valide, les demandes de récupération restent indisponibles et un message explicite est affiché.

## Développement local

Prérequis : Node.js 20.9+ et PostgreSQL 15+.

Après avoir migré la base et créé un administrateur, vérifiez que le fichier `.env` contient bien `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER=mojo_app` et `PGPASSWORD=<APP_DB_PASSWORD>`, puis :

```bash
npm install
npm run dev
```

Commandes de validation :

```bash
npm run lint
npm run typecheck
npm run build
```

## Sécurité et production

- Ne versionnez jamais `.env`; remplacez les mots de passe d’exemple par des secrets uniques.
- En production, activez HTTPS. Le cookie de session devient alors `Secure`.
- Les sessions et changements d’accès sont enregistrés en base; l’application configure `app.user_id` dans chaque transaction utilisateur pour la RLS et l’audit.
- Les modules métiers non encore livrés affichent un écran d’attente et ne sont visibles qu’aux utilisateurs autorisés.
- La récupération du mot de passe par e-mail utilise SMTP configurable par environnement; elle reste inactive tant que le SMTP n’est pas configuré.
- Testez la restauration des sauvegardes avant toute mise en production.
- La durée de session et le nombre d’échecs de connexion proviennent de `app_settings`.

Les décisions métier encore ouvertes (seuils DG, pourcentage et base du fonds d’urgence, taux de change et règles de paie) figurent dans les documents de conception.
