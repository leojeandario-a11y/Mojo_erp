# MoJo ERP — Plateforme de gestion intégrée MoJoPIKtures

**État : Lots 16 et 17 en cours, non validés.** Les lots antérieurs restent soumis
aux états et prérequis consignés dans [`INSTRUCTION.md`](./INSTRUCTION.md).
La conception et la base du Sprint 0 sont livrées. Le socle Next.js comprend l’authentification, les préférences, le tableau de bord et l’administration. Les états, recettes, prérequis et blocages de chaque lot sont suivis dans [`INSTRUCTION.md`](./INSTRUCTION.md); aucun lot n’est validé par la seule présence de code ou de tests automatisés.

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

Pour une récupération locale lorsque SMTP n’est pas disponible, PowerShell 7 peut lancer le script d’urgence :

```powershell
pwsh -NoProfile -File .\scripts\reset_password.ps1
```

Exécutez-le depuis un poste de confiance avec l’application saine sur `127.0.0.1:3000` et le `.env` local configuré pour `mojo_erp`. Le script vérifie la base cible, demande l’adresse du compte actif et requiert de saisir `RESET` pour confirmer. Le nouveau mot de passe est saisi deux fois dans des invites masquées; il n’est ni placé dans les arguments ni écrit dans un fichier. Le script crée un jeton à usage unique de dix minutes, appelle l’endpoint normal de réinitialisation, journalise l’opération et révoque les sessions existantes. Il ne fonctionne pas sur une base différente de `mojo_erp`; ne l’exécutez que si vous autorisez explicitement cette réinitialisation.

## Administration (Lot 3)

- **Utilisateurs** : affectez chaque rôle globalement ou à une entité; les permissions liées à une entité doivent être vérifiées avec l’entité cible dans les services métier.
- **Rôles et permissions** : créez un rôle personnalisé, puis limitez-le aux permissions que vous détenez. Le rôle `super_admin` et la permission universelle `*` sont protégés.
- **Directions** : gérez leurs codes, couleurs, responsables et état actif.
- **Configuration** : les paramètres exposés incluent les devises par défaut, le mois d’ouverture de l’exercice, la durée des nouvelles sessions et le seuil de verrouillage. Toute modification est auditée.
- **Journal d’audit** : filtrez par période, acteur, module, action et résultat, puis exportez jusqu’à 10 000 événements en CSV.

## Finance (Lot 4 — accepté le 2026-11-04)

- **Comptes** : gérez les comptes par entité (caisse, banque, argent mobile ou autre), en HTG ou USD. Le solde initial démarre à 0 et peut être modifié ensuite; les changements sont audités. Les numéros enregistrés dans l’interface sont des numéros masqués.
- **Taux de change** : les utilisateurs autorisés saisissent manuellement un taux et sa date d’effet. Une correction sur la même date et la même paire de devises remplace l’entrée précédente avec une trace d’audit.
- **Transactions** : les revenus et dépenses sont créés comme brouillons et numérotés automatiquement par entité et année civile (par exemple `MOJO-2026-000001`). La validation est réservée à un autre utilisateur autorisé; le taux de conversion USD est figé à la date choisie.
- **Contre-passation** : crée une écriture inverse en brouillon à une date et avec un motif explicitement saisis. L’originale reste validée jusqu’à la validation indépendante du brouillon inverse; alors les deux changements d’état sont enregistrés atomiquement. Une seule contre-passation est permise par écriture originale.
- **Caisse et transferts** : ouverture/clôture quotidienne par compte caisse, contrôles configurables de plafond et tolérance d’écart, transferts entre comptes de même entité/devise enregistrés comme deux transactions liées et validés ensemble.
- **Catégories** : référentiel hiérarchique configurable par entité. La direction a confirmé les dépenses Salaire Employeur, Loyer, Fournitures et Transport, ainsi que la recette Ventes; elles sont configurées sur les entités actives principales.
- **Paiements et dettes** : un paiement/encaissement crée une transaction liée en brouillon. La dette sert au suivi du solde; chaque remboursement crée une dépense brouillon liée, réserve son montant et ne réduit le solde qu’après validation.
- **Recherche et export** : filtre des transactions par période, type, état et recherche (numéro, description, entité, compte ou catégorie); export CSV filtré jusqu’à 10 000 lignes.
- **Ajustements** : création avec montant positif et sens explicite (augmentation ou diminution du solde); l’écriture inverse conserve le montant et inverse le sens.
- **Justificatifs Finance en local** : PDF, JPEG et PNG de 10 Mo maximum sont enregistrés hors du dépôt et du répertoire public dans `%USERPROFILE%\.mojo-erp\private-finance-documents`. Le créateur peut joindre un fichier à son brouillon; la lecture exige la permission Finance de l’entité ou l’appartenance au brouillon. `FINANCE_DOCUMENTS_DIR` peut remplacer le chemin local. Ce stockage n’est pas synchronisé vers le cloud; choisir et configurer le fournisseur avant un déploiement hébergé.
- La recette technique isolée du 2026-11-01 couvre 73 contrôles API/DB sur taux, comptes, catégories, cycles, séparation des tâches, contre-passations, transferts, caisse, dettes, remboursements, justificatifs et exports. Les critères chiffrés de conversion combinée et l’équilibre de 50 opérations ont été vérifiés. Le rapport de recette est dans [`docs/lot4-finance-test-report.md`](./docs/lot4-finance-test-report.md); la base QA reste distincte de `mojo_erp`.
- **Lot 4 accepté par Augustin le 2026-11-04.** La recette technique est documentée; le rapport ne remplace pas l’archive ZIP de livraison prévue par la feuille de route, qui reste à produire. Les seuils de caisse restent configurables et doivent être renseignés compte par compte avant les opérations.

## Budgets, approbations et notifications (Lot 5)

- Les budgets sont annuels ou mensuels, avec lignes par catégorie/libellé, devise et seuil d’alerte configurable. Les périmètres disponibles sont l’entité, une direction, un projet, des catégories, Marketing (`MKT`), Opérations (`OPS`) et Ressources humaines (`DRH`). Les périmètres par module rapprochent les transactions affectées à la direction correspondante.
- Le suivi compare les dépenses validées de la période au budget dans sa devise. Les montants HTG/USD utilisent le taux historique de chaque transaction; si un taux requis manque, le total réel est déclaré indisponible plutôt que partiel.
- Les workflows actifs et leurs étapes, rôles/utilisateurs approbateurs et seuils USD se configurent sous `/settings/approval-workflows`. Les files proposent « À traiter », « Mes demandes » et « Historique ». Les parcours branchés sont les dépenses, demandes d’achat et budgets; le workflow de budget est initialisé DAF puis DG, sans seuil monétaire imposé. Les règles définitives restent modifiables depuis l’administration.
- L’approbateur ne peut pas décider sur sa propre demande et doit être assigné à l’étape courante et autorisé sur l’entité. Les décisions sont auditées. La dépense approuvée attend encore sa validation comptable; le refus la rejette. Les dépenses, achats et budgets peuvent être renvoyés au demandeur, modifiés et resoumis dans un nouveau cycle.
- Le centre in-app gère le badge, la liste et le marquage comme lu. Les tâches planifiées créent des rappels idempotents pour factures en retard, paiements attendus, contrats arrivant à échéance, seuils budgétaires atteints et projets en retard. Configurez `MOJO_SCHEDULED_TASK_TOKEN` avec un secret privé d’au moins 32 caractères et, si nécessaire, `MOJO_SCHEDULED_REMINDER_WINDOW_DAYS` (0–30, défaut 7). Appelez quotidiennement `scripts/run_scheduled_notifications.ps1` depuis le Planificateur de tâches Windows avec le token transmis dans l’environnement du processus.
- Le push web est optionnel. Pour l’activer, configurez ensemble `MOJO_WEB_PUSH_PUBLIC_KEY`, `MOJO_WEB_PUSH_PRIVATE_KEY` et `MOJO_WEB_PUSH_SUBJECT` dans l’environnement serveur; ne versionnez jamais la clé privée. Le navigateur doit être sur HTTPS (ou localhost). L’envoi utilise une file avec reprises et suppression des abonnements expirés.
- Le tableau des workflows actuellement actifs sur `mojo_erp` est dans [`docs/lot5-active-workflows.md`](./docs/lot5-active-workflows.md). La migration `021_lot5_budget_schedule_push.sql` est inscrite dans le registre principal, vérifié en lecture seule le 2026-11-04. Les scénarios de seuils, droits, retours/resoumissions, transitions et rappels sont testés en QA isolée; les essais de recette n’écrivent pas dans `mojo_erp`. **Augustin a accepté le Lot 5 le 2026-11-04**; aucune demande de test n’a été créée dans `mojo_erp` et l’approbation réelle depuis un téléphone n’a pas été exécutée. L’archive `mojo-erp-lot5.zip` reste à produire.

Utilisez une URL absolue pour `APP_BASE_URL`. En production, elle doit utiliser HTTPS; HTTP est accepté uniquement pour les adresses locales `localhost`, `127.0.0.1` ou `::1`. `SMTP_USER` et `SMTP_PASSWORD` doivent être définis ensemble. Sans identifiants ou adresse d’expéditeur valide, les demandes de récupération restent indisponibles et un message explicite est affiché.

## Rapports et analytique (Lot 16 — en cours)

Le centre de rapports rassemble Finance, RH, Affaires, Marketing, Opérations et Store. Les requêtes sont filtrées par période et entité avec les permissions de lecture propres à chaque module; les résultats sont plafonnés à 1 000 lignes. Les montants RH sont agrégés, les montants d’Affaires restent groupés par devise, et Marketing/Opérations n’affichent les dépenses que si l’utilisateur peut lire les transactions Finance. L’export Excel XLSX ajoute l’identité MoJoPIKtures, le titre, la période et la date de génération dans la langue de l’utilisateur. L’impression navigateur propose l’enregistrement PDF avec logo, titre, périmètre et dates localisés; choisissez « Enregistrer au format PDF » dans le dialogue d’impression.

Le tableau de bord DG présente aussi, pour la période choisie, les revenus, dépenses et nets USD validés par direction, consolidés sur les entités auxquelles l’utilisateur a accès. Cette vue exige à la fois l’accès global au tableau de bord et la permission Finance; elle n’est pas encore rapprochée visuellement avec un jeu de données de recette.

Les six catégories ont répondu HTTP 200 lors des contrôles authentifiés, sur une période sans lignes; les données métier, la recette visuelle complète et l’acceptation restent à vérifier. Les planifications sont désactivées tant que la migration `034_lot16_scheduled_reports.sql` n’a pas été appliquée avec un rôle propriétaire de la base. L’application n’a pas les privilèges requis pour appliquer cette migration.

## Sauvegardes chiffrées (Lot 17 — non validé)

Le service de sauvegarde Compose en clair dans `./backups` a été remplacé par un profil ponctuel `encrypted-backup`. Le flux proposé exporte une archive PostgreSQL, la chiffre en streaming avec AES-256-GCM, vérifie son authenticité et son format, puis publie le fichier chiffré sur un répertoire hôte monté. Il n’efface pas automatiquement les anciennes sauvegardes. Configurez un véritable stockage hors hôte et définissez `MOJO_BACKUP_OFFSITE_HOST_PATH` dans `.env`; gardez la clé de 32 octets hors du dépôt et dans un gestionnaire de secrets.

Générez une clé une seule fois et conservez-la de façon sûre; la perte de cette clé rend les archives irrécupérables :

```powershell
node -p "require('node:crypto').randomBytes(32).toString('hex')"
$env:MOJO_BACKUP_ENCRYPTION_KEY = '<clé hexadécimale de 64 caractères conservée dans un coffre sûr>'
$env:MOJO_BACKUP_OFFSITE_HOST_PATH = 'X:\MoJo-Backups'
docker compose --profile encrypted-backup run --rm --build backup
```

Le chemin `X:\MoJo-Backups` doit être un volume hors hôte réellement monté et accessible à Docker Desktop; il ne doit pas pointer vers le dépôt ni vers un volume local non sauvegardé. Planifiez la commande ponctuelle avec le planificateur du système; aucune tâche automatique ni politique de rétention n’est configurée.

Pour contrôler une archive, définissez la même clé et le même chemin, puis exécutez :

```powershell
docker compose --profile encrypted-backup run --rm --entrypoint node backup `
  /app/scripts/restore-encrypted.mjs --verify /offsite/<nom-de-l-archive>.dump.enc
```

Un essai de restauration isolé exige `MOJO_RESTORE_TEST_DATABASE` avec un nom neuf se terminant par `_restore_test` et un compte PostgreSQL autorisé à créer une base :

```powershell
$env:MOJO_RESTORE_TEST_DATABASE = 'mojo_restore_test'
docker compose --profile encrypted-backup run --rm --entrypoint node backup `
  /app/scripts/restore-encrypted.mjs --restore /offsite/<nom-de-l-archive>.dump.enc
```

Le script refuse la base source, conserve la base d’essai pour vérification manuelle et ne la supprime pas. La restauration réelle, la durée de reprise, le stockage hors hôte et la construction du conteneur ne sont pas encore validés. Ne déployez pas sur la foi de ces scripts seuls.

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
- La sauvegarde chiffrée et la restauration isolée sont encore à configurer et à tester avant toute mise en production; consultez les sections Lot 16 et Lot 17 de [`INSTRUCTION.md`](./INSTRUCTION.md).
- La durée de session et le nombre d’échecs de connexion proviennent de `app_settings`.

Les décisions métier encore ouvertes (seuils DG, pourcentage et base du fonds d’urgence, taux de change et règles de paie) figurent dans les documents de conception.
