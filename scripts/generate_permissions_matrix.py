#!/usr/bin/env python3
"""Génère docs/04-matrice-roles-permissions.md depuis la base. Même usage que generate_docs.py."""
import os, subprocess, shlex
PSQL = os.environ.get("PSQL_CMD") or f"psql {shlex.quote(os.environ.get('DATABASE_URL',''))} -tA -F '|' -q"
def q(sql):
    o = subprocess.run(PSQL, shell=True, input=sql, capture_output=True, text=True, check=True).stdout
    return [l.split("|") for l in o.strip().splitlines() if l]
roles = q("SELECT code,name FROM roles ORDER BY created_at, code")
perms = q("SELECT code FROM permissions WHERE code<>'*' ORDER BY module, code")
rp = {(r,p) for r,p in q("SELECT r.code,p.code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id")}
short = {"super_admin":"SA","dg":"DG","daf":"DAF","drh":"RH","affaires":"AFF","marketing":"MKT","operations":"OPS","comptable":"CPT","assistant_admin":"ASS","caissier":"CAI","stock_manager":"STK","project_manager":"PRJ","standard_user":"USR"}
md = ["# Livrable 4 — Matrice des rôles et permissions\n",
      "Généré depuis la base. ✓ = permission accordée. **SA (Super Administrator) possède la permission universelle `*`** (toutes les lignes). "
      "Les permissions sont contrôlées côté serveur (API + services) et, pour RH/salaires/documents, côté base (Row-Level Security).\n",
      "Légende : " + ", ".join(f"**{short.get(c,c)}** = {n}" for c,n in roles) + "\n",
      "| Permission | " + " | ".join(short.get(c,c) for c,_ in roles) + " |",
      "|---|" + "---|"*len(roles)]
for p, in perms:
    row = [("✓" if c=="super_admin" or (c,p) in rp else "") for c,_ in roles]
    md.append(f"| `{p}` | " + " | ".join(row) + " |")
md += ["\n## Règles complémentaires\n",
 "- Les rôles et leurs permissions sont **modifiables depuis l'administration** (`settings.roles.manage`) ; chaque modification est auditée.",
 "- Un utilisateur peut cumuler plusieurs rôles ; une portée par entité (MoJoPIKtures / MOJO Store) est possible via `user_roles.entity_id`.",
 "- **Séparation des tâches** : celui qui crée une dépense ne peut pas la valider lui-même (contrôlé dans le service d'approbation).",
 "- Le **DAF** voit les salaires (`hr.salary.read`) pour la paie mais n'a pas `finance.fund.set_rate` ni `finance.fund.approve_withdrawal` : ces décisions relèvent de la DG.",
 "- Les données RH/salaires ont un niveau de confidentialité supérieur (RLS) : sans permission, la base renvoie zéro ligne, même en cas de faille côté interface."]
open(os.path.join(os.path.dirname(__file__),"../docs/04-matrice-roles-permissions.md"),"w").write("\n".join(md)+"\n")
print(len(perms),"permissions,",len(roles),"rôles")
