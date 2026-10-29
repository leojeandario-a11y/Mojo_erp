#!/usr/bin/env python3
"""Génère docs/02-erd.md et docs/03-tables-et-champs.md à partir de la base réelle.
Usage: DATABASE_URL=postgres://... python3 scripts/generate_docs.py
(ou PSQL_CMD="<commande psql lisant le SQL sur stdin, sortie -tA -F|>")"""
import os, re, subprocess, glob, collections, shlex

PSQL = os.environ.get("PSQL_CMD") or f"psql {shlex.quote(os.environ.get('DATABASE_URL',''))} -tA -F '|' -q"
ROOT = os.path.join(os.path.dirname(__file__), "..")

def q(sql):
    out = subprocess.run(PSQL, shell=True, input=sql, capture_output=True, text=True, check=True).stdout
    return [l.split("|") for l in out.strip().splitlines() if l]

# module <- fichier de migration
GROUPS = {"001":"Noyau","002":"Finance","003":"Ressources humaines","004":"Affaires","005":"Marketing et opérations","006":"MOJO Store","007":"Approbations et notifications"}
table_group = {}
for f in sorted(glob.glob(os.path.join(ROOT,"db/migrations/*.sql"))):
    key = os.path.basename(f)[:3]
    if key in GROUPS:
        for t in re.findall(r"CREATE TABLE (\w+)", open(f).read()):
            table_group[t] = GROUPS[key]

cols = q("""SELECT c.table_name, c.column_name, c.data_type || COALESCE('('||c.character_maximum_length||')',''),
  c.is_nullable, COALESCE(c.column_default,''), COALESCE(c.generation_expression,''),
  COALESCE(d.description,'')
  FROM information_schema.columns c
  LEFT JOIN pg_catalog.pg_statio_all_tables st ON st.relname=c.table_name AND st.schemaname='public'
  LEFT JOIN pg_catalog.pg_description d ON d.objoid=st.relid AND d.objsubid=c.ordinal_position
  WHERE c.table_schema='public' AND c.table_name IN (SELECT tablename FROM pg_tables WHERE schemaname='public')
  ORDER BY c.table_name, c.ordinal_position""")
pks = collections.defaultdict(set)
for t,c in q("""SELECT tc.table_name,kcu.column_name FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
  WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public'"""): pks[t].add(c)
fks = q("""SELECT con.conrelid::regclass::text, a.attname, con.confrelid::regclass::text
  FROM pg_constraint con JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=con.conkey[1]
  WHERE con.contype='f' AND con.connamespace='public'::regnamespace ORDER BY 1,2""")
fkcols = {(t,c) for t,c,_ in fks}
views = [r[0] for r in q("SELECT viewname FROM pg_views WHERE schemaname='public'")]

by_table = collections.OrderedDict()
for t,c,ty,nl,df,gen,desc in cols:
    if t in views: continue
    by_table.setdefault(t, []).append((c,ty,nl,df,gen))

# ---- 03 tables et champs
md = ["# Livrable 3 — Tables et champs\n",
      "Document généré automatiquement depuis la base PostgreSQL (`scripts/generate_docs.py`). "
      f"**{len(by_table)} tables**, {len(views)} vues.\n"]
groups = collections.OrderedDict((g,[]) for g in GROUPS.values())
for t in by_table:
    groups[table_group.get(t,"Noyau")].append(t)
for g, tbls in groups.items():
    md.append(f"\n## {g}\n")
    for t in sorted(tbls):
        md.append(f"\n### `{t}`\n\n| Champ | Type | Null | Défaut / calcul | Clé |\n|---|---|---|---|---|")
        for c,ty,nl,df,gen in by_table[t]:
            key = "PK" if c in pks[t] else ("FK" if (t,c) in fkcols else "")
            tgt = next((r for tt,cc,r in fks if tt==t and cc==c), "")
            if tgt: key = f"FK → {tgt}"
            d = (gen and f"GÉNÉRÉ: {gen}") or df
            md.append(f"| {c} | {ty} | {'oui' if nl=='YES' else 'non'} | {d.replace('|','/')[:60]} | {key} |")
md.append("\n## Vues\n")
for v in sorted(views): md.append(f"- `{v}`")
open(os.path.join(ROOT,"docs/03-tables-et-champs.md"),"w").write("\n".join(md)+"\n")

# ---- 02 ERD (un diagramme Mermaid par module)
erd = ["# Livrable 2 — Diagramme ERD\n",
       "Un diagramme par module (lisible). Les clés étrangères vers un autre module sont signalées par la table cible en pointillé. "
       "Rendu: GitHub, VS Code (extension Mermaid) ou https://mermaid.live.\n"]
for g, tbls in groups.items():
    if not tbls: continue
    s = set(tbls)
    erd.append(f"\n## {g}\n\n```mermaid\nerDiagram")
    ext = set()
    rels = []
    for t,c,r in fks:
        if t in s or r in s:
            if t not in s: ext.add(t)
            if r not in s: ext.add(r)
            rels.append((r,t,c))
    for t in sorted(s|ext):
        erd.append(f"  {t} {{")
        for c,ty,nl,df,gen in by_table.get(t,[]):
            if t in s:
                if c in pks[t] or (t,c) in fkcols:
                    tag = "PK" if c in pks[t] else "FK"
                    erd.append(f"    {ty.split('(')[0].replace(' ','_')} {c} {tag}")
        if t not in s: erd.append("    text externe_au_module")
        erd.append("  }")
    seen=set()
    for r,t,c in rels:
        if (r,t,c) in seen: continue
        seen.add((r,t,c))
        erd.append(f"  {r} ||--o{{ {t} : \"{c}\"")
    erd.append("```")
open(os.path.join(ROOT,"docs/02-erd.md"),"w").write("\n".join(erd)+"\n")
print(f"{len(by_table)} tables, {len(fks)} clés étrangères documentées")
