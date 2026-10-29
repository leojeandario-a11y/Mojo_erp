-- 009_seed.sql : données initiales (aucune valeur financière codée en dur : pas de % de fonds, pas de taux)
INSERT INTO currencies(code,name,symbol) VALUES ('HTG','Gourde haïtienne','G'),('USD','Dollar américain','$');

INSERT INTO entities(code,name) VALUES ('MOJO','MoJoPIKtures');
INSERT INTO entities(code,name,parent_id) SELECT 'STORE','MOJO Store', id FROM entities WHERE code='MOJO';

INSERT INTO departments(code,name,color) VALUES
 ('DG','Direction Générale','#1F3A5F'),
 ('DAF','Direction Administrative et Financière','#2E7D6B'),
 ('DRH','Direction des Ressources Humaines','#8A5A9E'),
 ('AFF','Direction des Affaires','#B26A2B'),
 ('MKT','Direction Marketing','#C2456B'),
 ('OPS','Direction des Opérations','#4A6FA5');

INSERT INTO stock_locations(name,is_default) VALUES ('MOJO Store - Principal', true);

INSERT INTO leave_types(code,name,days_per_year,is_paid) VALUES
 ('ANNUAL','Congé annuel',NULL,true),('SICK','Congé maladie',NULL,true),
 ('UNPAID','Congé sans solde',NULL,false),('MATERNITY','Congé maternité/paternité',NULL,true);

-- Paramètres (valeurs modifiables depuis l'administration)
INSERT INTO app_settings(key,value,description) VALUES
 ('reference_currency','"USD"','Devise de référence des consolidations'),
 ('default_display_currency','"USD"','Devise d''affichage par défaut (chaque utilisateur peut basculer)'),
 ('supported_locales','["fr","ht","en"]','Langues de l''interface'),
 ('fiscal_year_start_month','1','Mois de début de l''exercice'),
 ('session_ttl_minutes','480','Durée de session'),
 ('max_failed_logins','5','Verrouillage après N échecs');

-- ===== Rôles =====
INSERT INTO roles(code,name,is_system) VALUES
 ('super_admin','Super Administrator',true),
 ('dg','Directeur Général',true),
 ('daf','Responsable DAF',true),
 ('drh','Responsable RH',true),
 ('affaires','Responsable Affaires',true),
 ('marketing','Responsable Marketing',true),
 ('operations','Responsable Opérations',true),
 ('comptable','Comptable',true),
 ('assistant_admin','Assistant administratif',true),
 ('caissier','Caissier',true),
 ('stock_manager','Gestionnaire de stock',true),
 ('project_manager','Responsable projet',true),
 ('standard_user','Utilisateur standard',true);

-- ===== Permissions =====
INSERT INTO permissions(code,module) VALUES ('*','system');
INSERT INTO permissions(code,module)
SELECT c, split_part(c,'.',1) FROM unnest(ARRAY[
 'dashboard.global.read','dashboard.department.read',
 'finance.transaction.read','finance.transaction.create','finance.transaction.validate','finance.transaction.reverse',
 'finance.account.manage','finance.budget.read','finance.budget.manage','finance.rate.manage','finance.report.read',
 'finance.fund.read','finance.fund.contribute','finance.fund.request_withdrawal','finance.fund.approve_withdrawal','finance.fund.set_rate',
 'hr.employee.read','hr.employee.manage','hr.salary.read','hr.salary.manage','hr.leave.request','hr.leave.approve',
 'hr.attendance.manage','hr.recruitment.manage','hr.report.read',
 'business.customer.read','business.customer.manage','business.opportunity.manage','business.contract.read','business.contract.manage',
 'business.invoice.read','business.invoice.manage','business.payment.record','business.report.read',
 'marketing.campaign.read','marketing.campaign.manage','marketing.content.manage','marketing.report.read',
 'operations.project.read','operations.project.manage','operations.task.manage','operations.report.read',
 'store.product.read','store.product.manage','store.stock.manage','store.pos.sell','store.exhibitor.manage','store.report.read','store.finance.read',
 'approvals.approve','approvals.configure',
 'settings.users.manage','settings.roles.manage','settings.config.manage',
 'audit.read','documents.read','documents.manage','reports.export'
]) AS c;

-- Association rôles/permissions (modifiable ensuite depuis l'interface)
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='super_admin' AND p.code='*';

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='dg' AND (
  p.code LIKE '%.read' OR p.code LIKE '%.report.read' OR
  p.code IN ('approvals.approve','approvals.configure','finance.fund.approve_withdrawal','finance.fund.set_rate',
             'finance.transaction.validate','hr.leave.approve','audit.read','reports.export'));

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='daf' AND (
  p.code LIKE 'finance.%' OR p.code IN ('approvals.approve','reports.export','business.invoice.read','business.payment.record',
  'dashboard.department.read','store.finance.read','store.report.read','documents.read','hr.salary.read')) 
  AND p.code NOT IN ('finance.fund.set_rate','finance.fund.approve_withdrawal');

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='drh' AND (
  p.code LIKE 'hr.%' OR p.code IN ('dashboard.department.read','documents.read','documents.manage','approvals.approve'));

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='affaires' AND (
  p.code LIKE 'business.%' AND p.code <> 'business.payment.record' OR p.code IN ('dashboard.department.read','approvals.approve','documents.read'));

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='marketing' AND (
  p.code LIKE 'marketing.%' OR p.code IN ('dashboard.department.read','approvals.approve','finance.budget.read'));

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='operations' AND (
  p.code LIKE 'operations.%' OR p.code IN ('dashboard.department.read','approvals.approve','store.product.read','store.stock.manage','store.report.read','store.exhibitor.manage','finance.budget.read'));

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='comptable' AND p.code IN
 ('finance.transaction.read','finance.transaction.create','finance.budget.read','finance.report.read','finance.fund.read',
  'business.invoice.read','business.payment.record','reports.export','dashboard.department.read');

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='assistant_admin' AND p.code IN
 ('documents.read','documents.manage','business.customer.read','dashboard.department.read','hr.leave.request');

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='caissier' AND p.code IN
 ('store.pos.sell','store.product.read','dashboard.department.read');

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='stock_manager' AND p.code IN
 ('store.product.read','store.product.manage','store.stock.manage','dashboard.department.read');

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='project_manager' AND p.code IN
 ('operations.project.read','operations.project.manage','operations.task.manage','dashboard.department.read');

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r, permissions p WHERE r.code='standard_user' AND p.code IN
 ('dashboard.department.read','hr.leave.request');

-- ===== Workflows d'approbation par défaut (étapes et seuils MODIFIABLES depuis l'administration) =====
-- Seuils NULL = étape toujours requise. Les seuils DG sont à définir par la direction (voir README).
INSERT INTO approval_workflows(request_type,name) VALUES
 ('purchase','Demande d''achat'),('fund_withdrawal','Retrait du fonds d''urgence'),
 ('expense','Dépense exceptionnelle'),('leave','Demande de congé'),('payroll','Paie'),('contract','Contrat'),('project','Projet'),('fund_rate','Modification du pourcentage du fonds');

INSERT INTO approval_workflow_steps(workflow_id,step_order,label,approver_role_id,min_amount_usd)
SELECT w.id, s.ord, s.label, r.id, s.thr
FROM approval_workflows w
JOIN (VALUES
 ('purchase',1,'Responsable Opérations','operations',NULL::numeric),
 ('purchase',2,'DAF','daf',NULL),
 ('purchase',3,'Direction Générale (si au-dessus du seuil)','dg',0.01),
 ('fund_withdrawal',1,'RAF / DAF','daf',NULL),
 ('fund_withdrawal',2,'Direction Générale','dg',NULL),
 ('expense',1,'DAF','daf',NULL),
 ('expense',2,'Direction Générale (si au-dessus du seuil)','dg',0.01),
 ('leave',1,'Responsable RH','drh',NULL),
 ('payroll',1,'DAF','daf',NULL),
 ('payroll',2,'Direction Générale','dg',NULL),
 ('contract',1,'Responsable Affaires','affaires',NULL),
 ('contract',2,'Direction Générale','dg',NULL),
 ('project',1,'Direction Générale','dg',NULL),
 ('fund_rate',1,'Direction Générale','dg',NULL)
) AS s(rt,ord,label,role_code,thr) ON s.rt = w.request_type
JOIN roles r ON r.code = s.role_code;
