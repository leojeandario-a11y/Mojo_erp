# Livrable 3 — Tables et champs

Document généré automatiquement depuis la base PostgreSQL (`scripts/generate_docs.py`). **84 tables**, 5 vues.


## Noyau


### `app_settings`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| key | text | non |  | PK |
| value | jsonb | non |  |  |
| description | text | oui |  |  |
| updated_by | uuid | oui |  | FK → users |
| updated_at | timestamp with time zone | non | now() |  |

### `audit_logs`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | bigint | non | nextval('audit_logs_id_seq'::regclass) | PK |
| occurred_at | timestamp with time zone | non | now() |  |
| user_id | uuid | oui |  |  |
| ip_address | text | oui |  |  |
| module | text | oui |  |  |
| action | text | non |  |  |
| table_name | text | oui |  |  |
| record_id | text | oui |  |  |
| old_values | jsonb | oui |  |  |
| new_values | jsonb | oui |  |  |
| result | text | non | 'success'::text |  |
| message | text | oui |  |  |

### `currencies`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| code | character(3) | non |  | PK |
| name | text | non |  |  |
| symbol | text | non |  |  |
| is_active | boolean | non | true |  |

### `departments`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| code | text | non |  |  |
| name | text | non |  |  |
| color | text | oui |  |  |
| head_user_id | uuid | oui |  | FK → users |
| is_active | boolean | non | true |  |
| created_at | timestamp with time zone | non | now() |  |

### `documents`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| owner_table | text | non |  |  |
| owner_id | uuid | non |  |  |
| title | text | non |  |  |
| file_name | text | non |  |  |
| storage_path | text | non |  |  |
| mime_type | text | oui |  |  |
| size_bytes | bigint | oui |  |  |
| sha256 | text | oui |  |  |
| confidentiality | text | non | 'general'::text |  |
| uploaded_by | uuid | oui |  | FK → users |
| created_at | timestamp with time zone | non | now() |  |

### `entities`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| code | text | non |  |  |
| name | text | non |  |  |
| parent_id | uuid | oui |  | FK → entities |
| is_active | boolean | non | true |  |
| created_at | timestamp with time zone | non | now() |  |

### `exchange_rates`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| rate_date | date | non |  |  |
| from_currency | character(3) | non |  | FK → currencies |
| to_currency | character(3) | non |  | FK → currencies |
| rate | numeric | non |  |  |
| entered_by | uuid | oui |  | FK → users |
| created_at | timestamp with time zone | non | now() |  |

### `password_reset_tokens`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| user_id | uuid | non |  | FK → users |
| token_hash | text | non |  |  |
| expires_at | timestamp with time zone | non |  |  |
| used_at | timestamp with time zone | oui |  |  |
| created_at | timestamp with time zone | non | now() |  |

### `permissions`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| code | text | non |  |  |
| module | text | non |  |  |
| description | text | oui |  |  |

### `role_permissions`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| role_id | uuid | non |  | FK → roles |
| permission_id | uuid | non |  | FK → permissions |

### `roles`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| code | text | non |  |  |
| name | text | non |  |  |
| description | text | oui |  |  |
| is_system | boolean | non | false |  |
| created_at | timestamp with time zone | non | now() |  |

### `user_roles`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| user_id | uuid | non |  | FK → users |
| role_id | uuid | non |  | FK → roles |
| entity_id | uuid | oui |  | FK → entities |
| granted_by | uuid | oui |  | FK → users |
| created_at | timestamp with time zone | non | now() |  |

### `user_sessions`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| user_id | uuid | non |  | FK → users |
| token_hash | text | non |  |  |
| ip_address | inet | oui |  |  |
| user_agent | text | oui |  |  |
| expires_at | timestamp with time zone | non |  |  |
| revoked_at | timestamp with time zone | oui |  |  |
| created_at | timestamp with time zone | non | now() |  |

### `users`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| email | USER-DEFINED | non |  |  |
| password_hash | text | non |  |  |
| full_name | text | non |  |  |
| phone | text | oui |  |  |
| department_id | uuid | oui |  | FK → departments |
| locale | text | non | 'fr'::text |  |
| display_currency | character(3) | non | 'USD'::bpchar | FK → currencies |
| is_active | boolean | non | true |  |
| failed_logins | integer | non | 0 |  |
| locked_until | timestamp with time zone | oui |  |  |
| last_login_at | timestamp with time zone | oui |  |  |
| mfa_secret | text | oui |  |  |
| created_at | timestamp with time zone | non | now() |  |
| updated_at | timestamp with time zone | non | now() |  |

## Finance


### `accounts`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| name | text | non |  |  |
| account_type | text | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| bank_name | text | oui |  |  |
| account_number_masked | text | oui |  |  |
| opening_balance | numeric | non | 0 |  |
| is_active | boolean | non | true |  |
| created_at | timestamp with time zone | non | now() |  |

### `budget_lines`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| budget_id | uuid | non |  | FK → budgets |
| category_id | uuid | oui |  | FK → transaction_categories |
| label | text | oui |  |  |
| planned_amount | numeric | non |  |  |

### `budgets`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| name | text | non |  |  |
| fiscal_year | integer | non |  |  |
| period_type | text | non |  |  |
| period_month | integer | oui |  |  |
| scope | text | non |  |  |
| department_id | uuid | oui |  | FK → departments |
| project_id | uuid | oui |  | FK → projects |
| currency | character(3) | non |  | FK → currencies |
| status | text | non | 'draft'::text |  |
| alert_threshold_pct | numeric | non | 90 |  |
| created_by | uuid | oui |  | FK → users |
| created_at | timestamp with time zone | non | now() |  |

### `debt_payments`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| debt_id | uuid | non |  | FK → debts |
| amount | numeric | non |  |  |
| paid_at | date | non |  |  |
| transaction_id | uuid | oui |  | FK → transactions |

### `debts`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| creditor | text | non |  |  |
| description | text | oui |  |  |
| principal | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| incurred_on | date | non |  |  |
| due_date | date | oui |  |  |
| status | text | non | 'open'::text |  |
| created_at | timestamp with time zone | non | now() |  |

### `emergency_fund_rates`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| fund_id | uuid | non |  | FK → emergency_funds |
| percentage | numeric | non |  |  |
| effective_from | date | non |  |  |
| reason | text | oui |  |  |
| approval_request_id | uuid | oui |  | FK → approval_requests |
| set_by | uuid | oui |  | FK → users |
| created_at | timestamp with time zone | non | now() |  |

### `emergency_funds`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| name | text | non | 'Fonds d''urgence'::text |  |
| target_amount | numeric | oui |  |  |
| currency | character(3) | non |  | FK → currencies |
| account_id | uuid | oui |  | FK → accounts |
| is_active | boolean | non | true |  |
| created_at | timestamp with time zone | non | now() |  |

### `fund_contributions`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| fund_id | uuid | non |  | FK → emergency_funds |
| source_tx_id | uuid | oui |  | FK → transactions |
| rate_id | uuid | oui |  | FK → emergency_fund_rates |
| base_amount | numeric | oui |  |  |
| percentage_applied | numeric | oui |  |  |
| amount | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| contribution_date | date | non |  |  |
| kind | text | non | 'automatic'::text |  |
| transaction_id | uuid | oui |  | FK → transactions |
| created_by | uuid | oui |  | FK → users |
| created_at | timestamp with time zone | non | now() |  |

### `fund_withdrawals`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| fund_id | uuid | non |  | FK → emergency_funds |
| requested_by | uuid | non |  | FK → users |
| amount | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| reason | text | non |  |  |
| status | text | non | 'pending'::text |  |
| approval_request_id | uuid | oui |  | FK → approval_requests |
| transaction_id | uuid | oui |  | FK → transactions |
| requested_at | timestamp with time zone | non | now() |  |
| decided_at | timestamp with time zone | oui |  |  |
| disbursed_at | timestamp with time zone | oui |  |  |

### `inter_entity_transfers`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| from_entity_id | uuid | non |  | FK → entities |
| to_entity_id | uuid | non |  | FK → entities |
| reason | text | non |  |  |
| out_tx_id | uuid | oui |  | FK → transactions |
| in_tx_id | uuid | oui |  | FK → transactions |
| amount | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| status | text | non | 'pending'::text |  |
| created_by | uuid | oui |  | FK → users |
| created_at | timestamp with time zone | non | now() |  |

### `payments`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| direction | text | non |  |  |
| payee | text | non |  |  |
| amount | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| method | text | non |  |  |
| paid_at | date | non |  |  |
| reference | text | oui |  |  |
| transaction_id | uuid | oui |  | FK → transactions |
| created_by | uuid | oui |  | FK → users |
| created_at | timestamp with time zone | non | now() |  |

### `projects`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| code | text | non |  |  |
| name | text | non |  |  |
| description | text | oui |  |  |
| department_id | uuid | oui |  | FK → departments |
| manager_id | uuid | oui |  | FK → users |
| budget_amount | numeric | non | 0 |  |
| currency | character(3) | non |  | FK → currencies |
| start_date | date | oui |  |  |
| end_date | date | oui |  |  |
| status | text | non | 'planned'::text |  |
| progress_pct | numeric | non | 0 |  |
| created_at | timestamp with time zone | non | now() |  |
| updated_at | timestamp with time zone | non | now() |  |

### `transaction_categories`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | oui |  | FK → entities |
| code | text | non |  |  |
| name | text | non |  |  |
| kind | text | non |  |  |
| parent_id | uuid | oui |  | FK → transaction_categories |
| is_active | boolean | non | true |  |

### `transactions`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| tx_number | text | oui |  |  |
| tx_type | text | non |  |  |
| tx_date | date | non |  |  |
| account_id | uuid | non |  | FK → accounts |
| category_id | uuid | oui |  | FK → transaction_categories |
| department_id | uuid | oui |  | FK → departments |
| project_id | uuid | oui |  | FK → projects |
| amount | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| fx_rate_to_usd | numeric | non |  |  |
| amount_usd | numeric | oui | GÉNÉRÉ: round((amount * fx_rate_to_usd), 2) |  |
| description | text | oui |  |  |
| counterparty | text | oui |  |  |
| source_table | text | oui |  |  |
| source_id | uuid | oui |  |  |
| status | text | non | 'draft'::text |  |
| reversal_of_id | uuid | oui |  | FK → transactions |
| created_by | uuid | oui |  | FK → users |
| validated_by | uuid | oui |  | FK → users |
| validated_at | timestamp with time zone | oui |  |  |
| created_at | timestamp with time zone | non | now() |  |
| updated_at | timestamp with time zone | non | now() |  |

## Ressources humaines


### `attendance_records`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| employee_id | uuid | non |  | FK → employees |
| work_date | date | non |  |  |
| status | text | non |  |  |
| check_in | time without time zone | oui |  |  |
| check_out | time without time zone | oui |  |  |
| minutes_late | integer | non | 0 |  |
| note | text | oui |  |  |

### `candidates`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| job_opening_id | uuid | non |  | FK → job_openings |
| full_name | text | non |  |  |
| email | text | oui |  |  |
| phone | text | oui |  |  |
| stage | text | non | 'applied'::text |  |
| notes | text | oui |  |  |
| created_at | timestamp with time zone | non | now() |  |

### `departures`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| employee_id | uuid | non |  | FK → employees |
| departure_type | text | non |  |  |
| notice_date | date | oui |  |  |
| last_day | date | non |  |  |
| note | text | oui |  |  |

### `employee_salaries`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| employee_id | uuid | non |  | FK → employees |
| base_salary | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| pay_frequency | text | non | 'monthly'::text |  |
| effective_from | date | non |  |  |
| effective_to | date | oui |  |  |

### `employees`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| user_id | uuid | oui |  | FK → users |
| employee_code | text | non |  |  |
| first_name | text | non |  |  |
| last_name | text | non |  |  |
| birth_date | date | oui |  |  |
| national_id_masked | text | oui |  |  |
| phone | text | oui |  |  |
| address | text | oui |  |  |
| department_id | uuid | oui |  | FK → departments |
| entity_id | uuid | oui |  | FK → entities |
| job_title | text | oui |  |  |
| hire_date | date | non |  |  |
| end_date | date | oui |  |  |
| status | text | non | 'active'::text |  |
| contract_type | text | oui |  |  |
| manager_id | uuid | oui |  | FK → employees |
| created_at | timestamp with time zone | non | now() |  |
| updated_at | timestamp with time zone | non | now() |  |

### `employment_history`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| employee_id | uuid | non |  | FK → employees |
| change_type | text | non |  |  |
| from_value | text | oui |  |  |
| to_value | text | oui |  |  |
| effective_date | date | non |  |  |
| note | text | oui |  |  |

### `evaluations`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| employee_id | uuid | non |  | FK → employees |
| evaluator_id | uuid | oui |  | FK → users |
| period_label | text | non |  |  |
| score | numeric | oui |  |  |
| comments | text | oui |  |  |
| evaluated_on | date | non |  |  |

### `job_openings`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| title | text | non |  |  |
| department_id | uuid | oui |  | FK → departments |
| description | text | oui |  |  |
| status | text | non | 'open'::text |  |
| opened_on | date | oui |  |  |
| closed_on | date | oui |  |  |

### `leave_requests`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| employee_id | uuid | non |  | FK → employees |
| leave_type_id | uuid | non |  | FK → leave_types |
| start_date | date | non |  |  |
| end_date | date | non |  |  |
| days | numeric | non |  |  |
| reason | text | oui |  |  |
| status | text | non | 'pending'::text |  |
| approval_request_id | uuid | oui |  | FK → approval_requests |
| created_at | timestamp with time zone | non | now() |  |

### `leave_types`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| code | text | non |  |  |
| name | text | non |  |  |
| days_per_year | numeric | oui |  |  |
| is_paid | boolean | non | true |  |

### `payroll_entries`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| payroll_run_id | uuid | non |  | FK → payroll_runs |
| employee_id | uuid | non |  | FK → employees |
| gross_amount | numeric | non |  |  |
| bonuses | numeric | non | 0 |  |
| deductions | numeric | non | 0 |  |
| advances_recovered | numeric | non | 0 |  |
| net_amount | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| transaction_id | uuid | oui |  | FK → transactions |
| paid_at | date | oui |  |  |

### `payroll_runs`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| period_label | text | non |  |  |
| period_start | date | non |  |  |
| period_end | date | non |  |  |
| status | text | non | 'draft'::text |  |
| approval_request_id | uuid | oui |  | FK → approval_requests |
| created_by | uuid | oui |  | FK → users |
| created_at | timestamp with time zone | non | now() |  |

### `salary_adjustments`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| employee_id | uuid | non |  | FK → employees |
| kind | text | non |  |  |
| amount | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| adjust_date | date | non |  |  |
| reason | text | oui |  |  |
| status | text | non | 'pending'::text |  |
| approval_request_id | uuid | oui |  | FK → approval_requests |
| created_by | uuid | oui |  | FK → users |

### `training_participants`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| training_id | uuid | non |  | FK → trainings |
| employee_id | uuid | non |  | FK → employees |
| status | text | non | 'enrolled'::text |  |

### `trainings`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| title | text | non |  |  |
| provider | text | oui |  |  |
| start_date | date | oui |  |  |
| end_date | date | oui |  |  |
| cost | numeric | oui |  |  |
| currency | character(3) | oui |  | FK → currencies |

## Affaires


### `contract_milestones`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| contract_id | uuid | non |  | FK → contracts |
| label | text | non |  |  |
| due_date | date | non |  |  |
| amount | numeric | oui |  |  |
| status | text | non | 'pending'::text |  |

### `contracts`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| contract_number | text | non |  |  |
| contract_kind | text | non |  |  |
| customer_id | uuid | oui |  | FK → customers |
| supplier_id | uuid | oui |  | FK → suppliers |
| partner_id | uuid | oui |  | FK → partners |
| opportunity_id | uuid | oui |  | FK → opportunities |
| title | text | non |  |  |
| amount | numeric | oui |  |  |
| currency | character(3) | oui |  | FK → currencies |
| start_date | date | oui |  |  |
| end_date | date | oui |  |  |
| renewal_date | date | oui |  |  |
| auto_renew | boolean | non | false |  |
| terms | text | oui |  |  |
| status | text | non | 'draft'::text |  |
| approval_request_id | uuid | oui |  | FK → approval_requests |
| created_at | timestamp with time zone | non | now() |  |

### `customer_contacts`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| customer_id | uuid | non |  | FK → customers |
| full_name | text | non |  |  |
| job_title | text | oui |  |  |
| email | text | oui |  |  |
| phone | text | oui |  |  |

### `customer_interactions`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| customer_id | uuid | non |  | FK → customers |
| interaction_type | text | non |  |  |
| occurred_at | timestamp with time zone | non | now() |  |
| summary | text | non |  |  |
| created_by | uuid | oui |  | FK → users |

### `customers`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| kind | text | non | 'prospect'::text |  |
| company_name | text | oui |  |  |
| full_name | text | non |  |  |
| email | text | oui |  |  |
| phone | text | oui |  |  |
| address | text | oui |  |  |
| owner_id | uuid | oui |  | FK → users |
| notes | text | oui |  |  |
| created_at | timestamp with time zone | non | now() |  |
| updated_at | timestamp with time zone | non | now() |  |

### `invoice_items`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| invoice_id | uuid | non |  | FK → invoices |
| description | text | non |  |  |
| quantity | numeric | non |  |  |
| unit_price | numeric | non |  |  |
| line_total | numeric | oui | GÉNÉRÉ: round((quantity * unit_price), 2) |  |

### `invoice_payments`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| invoice_id | uuid | non |  | FK → invoices |
| amount | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| fx_rate_to_invoice_currency | numeric | non | 1 |  |
| method | text | non |  |  |
| paid_at | date | non |  |  |
| reference | text | oui |  |  |
| receipt_number | text | oui |  |  |
| transaction_id | uuid | oui |  | FK → transactions |
| created_by | uuid | oui |  | FK → users |

### `invoices`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| invoice_number | text | non |  |  |
| customer_id | uuid | non |  | FK → customers |
| contract_id | uuid | oui |  | FK → contracts |
| project_id | uuid | oui |  | FK → projects |
| issue_date | date | non |  |  |
| due_date | date | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| subtotal | numeric | non | 0 |  |
| discount | numeric | non | 0 |  |
| tax_amount | numeric | non | 0 |  |
| total | numeric | non | 0 |  |
| status | text | non | 'draft'::text |  |
| notes | text | oui |  |  |
| created_by | uuid | oui |  | FK → users |
| created_at | timestamp with time zone | non | now() |  |

### `opportunities`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| customer_id | uuid | non |  | FK → customers |
| title | text | non |  |  |
| service_requested | text | oui |  |  |
| stage | text | non | 'prospect'::text |  |
| estimated_amount | numeric | oui |  |  |
| currency | character(3) | oui |  | FK → currencies |
| expected_close | date | oui |  |  |
| owner_id | uuid | oui |  | FK → users |
| lost_reason | text | oui |  |  |
| created_at | timestamp with time zone | non | now() |  |
| updated_at | timestamp with time zone | non | now() |  |

### `opportunity_stage_history`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | bigint | non | nextval('opportunity_stage_history_id_seq'::regclass) | PK |
| opportunity_id | uuid | non |  | FK → opportunities |
| from_stage | text | oui |  |  |
| to_stage | text | non |  |  |
| changed_by | uuid | oui |  | FK → users |
| changed_at | timestamp with time zone | non | now() |  |

### `partners`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| name | text | non |  |  |
| partner_type | text | non |  |  |
| contact_name | text | oui |  |  |
| email | text | oui |  |  |
| phone | text | oui |  |  |
| commercial_terms | text | oui |  |  |
| start_date | date | oui |  |  |
| end_date | date | oui |  |  |
| status | text | non | 'active'::text |  |

### `suppliers`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | oui |  | FK → entities |
| name | text | non |  |  |
| contact_name | text | oui |  |  |
| email | text | oui |  |  |
| phone | text | oui |  |  |
| address | text | oui |  |  |
| payment_terms | text | oui |  |  |
| is_active | boolean | non | true |  |
| created_at | timestamp with time zone | non | now() |  |

## Marketing et opérations


### `activities`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| department_id | uuid | oui |  | FK → departments |
| title | text | non |  |  |
| description | text | oui |  |  |
| responsible_id | uuid | oui |  | FK → users |
| planned_date | date | oui |  |  |
| status | text | non | 'planned'::text |  |

### `campaign_expenses`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| campaign_id | uuid | non |  | FK → marketing_campaigns |
| transaction_id | uuid | non |  | FK → transactions |

### `campaign_results`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| campaign_id | uuid | non |  | FK → marketing_campaigns |
| recorded_on | date | non |  |  |
| channel | text | oui |  |  |
| impressions | bigint | oui |  |  |
| clicks | bigint | oui |  |  |
| leads | integer | oui |  |  |
| conversions | integer | oui |  |  |
| revenue_generated | numeric | oui |  |  |
| currency | character(3) | oui |  | FK → currencies |
| notes | text | oui |  |  |

### `content_items`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| campaign_id | uuid | oui |  | FK → marketing_campaigns |
| title | text | non |  |  |
| content_type | text | non |  |  |
| channel | text | oui |  |  |
| scheduled_at | timestamp with time zone | oui |  |  |
| published_at | timestamp with time zone | oui |  |  |
| status | text | non | 'idea'::text |  |
| owner_id | uuid | oui |  | FK → users |
| body | text | oui |  |  |

### `marketing_campaigns`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| name | text | non |  |  |
| objective | text | oui |  |  |
| department_id | uuid | oui |  | FK → departments |
| project_id | uuid | oui |  | FK → projects |
| budget_id | uuid | oui |  | FK → budgets |
| planned_budget | numeric | non | 0 |  |
| currency | character(3) | non |  | FK → currencies |
| start_date | date | oui |  |  |
| end_date | date | oui |  |  |
| owner_id | uuid | oui |  | FK → users |
| channels | ARRAY | non | '{}'::text[] |  |
| status | text | non | 'planned'::text |  |
| created_at | timestamp with time zone | non | now() |  |

### `project_expenses`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| project_id | uuid | non |  | FK → projects |
| transaction_id | uuid | non |  | FK → transactions |

### `project_members`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| project_id | uuid | non |  | FK → projects |
| user_id | uuid | non |  | FK → users |
| role_label | text | oui |  |  |

### `resource_allocations`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| resource_id | uuid | non |  | FK → resources |
| project_id | uuid | oui |  | FK → projects |
| task_id | uuid | oui |  | FK → tasks |
| from_date | date | non |  |  |
| to_date | date | non |  |  |

### `resources`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| name | text | non |  |  |
| resource_type | text | non |  |  |
| status | text | non | 'available'::text |  |

### `tasks`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| project_id | uuid | oui |  | FK → projects |
| department_id | uuid | oui |  | FK → departments |
| parent_task_id | uuid | oui |  | FK → tasks |
| title | text | non |  |  |
| description | text | oui |  |  |
| assignee_id | uuid | oui |  | FK → users |
| priority | text | non | 'medium'::text |  |
| status | text | non | 'todo'::text |  |
| due_date | date | oui |  |  |
| completed_at | timestamp with time zone | oui |  |  |
| created_by | uuid | oui |  | FK → users |
| created_at | timestamp with time zone | non | now() |  |

## MOJO Store


### `exhibitor_payments`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| exhibitor_id | uuid | non |  | FK → exhibitors |
| statement_id | uuid | oui |  | FK → exhibitor_statements |
| direction | text | non |  |  |
| amount | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| fx_rate_to_usd | numeric | non |  |  |
| paid_at | date | non |  |  |
| transaction_id | uuid | oui |  | FK → transactions |

### `exhibitor_statements`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| exhibitor_id | uuid | non |  | FK → exhibitors |
| period_start | date | non |  |  |
| period_end | date | non |  |  |
| sales_total_usd | numeric | non | 0 |  |
| commission_usd | numeric | non | 0 |  |
| rent_usd | numeric | non | 0 |  |
| net_due_to_exhibitor_usd | numeric | non | 0 |  |
| status | text | non | 'open'::text |  |

### `exhibitors`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| name | text | non |  |  |
| contact_name | text | oui |  |  |
| email | text | oui |  |  |
| phone | text | oui |  |  |
| space_label | text | oui |  |  |
| contract_id | uuid | oui |  | FK → contracts |
| rent_amount | numeric | non | 0 |  |
| rent_currency | character(3) | oui |  | FK → currencies |
| rent_period | text | oui |  |  |
| commission_pct | numeric | non | 0 |  |
| status | text | non | 'active'::text |  |
| created_at | timestamp with time zone | non | now() |  |

### `inventory_count_lines`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| count_id | uuid | non |  | FK → inventory_counts |
| product_id | uuid | non |  | FK → products |
| expected_qty | numeric | non |  |  |
| counted_qty | numeric | non |  |  |

### `inventory_counts`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| location_id | uuid | non |  | FK → stock_locations |
| counted_on | date | non |  |  |
| status | text | non | 'open'::text |  |
| created_by | uuid | oui |  | FK → users |

### `product_categories`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| name | text | non |  |  |
| parent_id | uuid | oui |  | FK → product_categories |

### `products`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| sku | text | non |  |  |
| barcode | text | oui |  |  |
| name | text | non |  |  |
| category_id | uuid | oui |  | FK → product_categories |
| supplier_id | uuid | oui |  | FK → suppliers |
| exhibitor_id | uuid | oui |  | FK → exhibitors |
| purchase_price | numeric | non | 0 |  |
| sale_price | numeric | non |  |  |
| price_currency | character(3) | non |  | FK → currencies |
| min_stock | integer | non | 0 |  |
| image_path | text | oui |  |  |
| status | text | non | 'active'::text |  |
| created_at | timestamp with time zone | non | now() |  |
| updated_at | timestamp with time zone | non | now() |  |

### `sale_items`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| sale_id | uuid | non |  | FK → sales |
| product_id | uuid | non |  | FK → products |
| quantity | numeric | non |  |  |
| unit_price | numeric | non |  |  |
| unit_cost | numeric | non | 0 |  |
| discount | numeric | non | 0 |  |
| line_total | numeric | oui | GÉNÉRÉ: round(((quantity * unit_price) - discount), 2) |  |

### `sale_payments`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| sale_id | uuid | non |  | FK → sales |
| method | text | non |  |  |
| amount | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| account_id | uuid | oui |  | FK → accounts |
| transaction_id | uuid | oui |  | FK → transactions |

### `sales`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| receipt_number | text | non |  |  |
| customer_id | uuid | oui |  | FK → customers |
| cashier_id | uuid | non |  | FK → users |
| sold_at | timestamp with time zone | non | now() |  |
| currency | character(3) | non |  | FK → currencies |
| fx_rate_to_usd | numeric | non |  |  |
| subtotal | numeric | non | 0 |  |
| discount | numeric | non | 0 |  |
| total | numeric | non | 0 |  |
| status | text | non | 'completed'::text |  |
| voided_by | uuid | oui |  | FK → users |
| created_at | timestamp with time zone | non | now() |  |

### `stock_locations`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| name | text | non |  |  |
| is_default | boolean | non | false |  |

### `stock_movements`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| product_id | uuid | non |  | FK → products |
| location_id | uuid | non |  | FK → stock_locations |
| movement_type | text | non |  |  |
| quantity | numeric | non |  |  |
| unit_cost | numeric | oui |  |  |
| sale_item_id | uuid | oui |  | FK → sale_items |
| reference | text | oui |  |  |
| note | text | oui |  |  |
| occurred_at | timestamp with time zone | non | now() |  |
| created_by | uuid | oui |  | FK → users |

## Approbations et notifications


### `approval_actions`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| request_id | uuid | non |  | FK → approval_requests |
| step_order | integer | non |  |  |
| actor_id | uuid | non |  | FK → users |
| decision | text | non |  |  |
| comment | text | oui |  |  |
| acted_at | timestamp with time zone | non | now() |  |

### `approval_requests`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| workflow_id | uuid | non |  | FK → approval_workflows |
| request_type | text | non |  |  |
| ref_table | text | non |  |  |
| ref_id | uuid | non |  |  |
| requester_id | uuid | non |  | FK → users |
| title | text | non |  |  |
| amount | numeric | oui |  |  |
| currency | character(3) | oui |  | FK → currencies |
| amount_usd | numeric | oui |  |  |
| current_step | integer | non | 1 |  |
| status | text | non | 'pending'::text |  |
| created_at | timestamp with time zone | non | now() |  |
| closed_at | timestamp with time zone | oui |  |  |

### `approval_workflow_steps`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| workflow_id | uuid | non |  | FK → approval_workflows |
| step_order | integer | non |  |  |
| label | text | non |  |  |
| approver_role_id | uuid | oui |  | FK → roles |
| approver_user_id | uuid | oui |  | FK → users |
| min_amount_usd | numeric | oui |  |  |

### `approval_workflows`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| request_type | text | non |  |  |
| entity_id | uuid | oui |  | FK → entities |
| name | text | non |  |  |
| is_active | boolean | non | true |  |

### `notifications`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| user_id | uuid | non |  | FK → users |
| kind | text | non |  |  |
| title | text | non |  |  |
| body | text | oui |  |  |
| link | text | oui |  |  |
| ref_table | text | oui |  |  |
| ref_id | uuid | oui |  |  |
| is_read | boolean | non | false |  |
| created_at | timestamp with time zone | non | now() |  |
| read_at | timestamp with time zone | oui |  |  |

### `purchase_requests`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| entity_id | uuid | non |  | FK → entities |
| department_id | uuid | oui |  | FK → departments |
| project_id | uuid | oui |  | FK → projects |
| supplier_id | uuid | oui |  | FK → suppliers |
| requester_id | uuid | non |  | FK → users |
| description | text | non |  |  |
| amount | numeric | non |  |  |
| currency | character(3) | non |  | FK → currencies |
| status | text | non | 'draft'::text |  |
| approval_request_id | uuid | oui |  | FK → approval_requests |
| created_at | timestamp with time zone | non | now() |  |

### `push_subscriptions`

| Champ | Type | Null | Défaut / calcul | Clé |
|---|---|---|---|---|
| id | uuid | non | gen_random_uuid() | PK |
| user_id | uuid | non |  | FK → users |
| endpoint | text | non |  |  |
| p256dh | text | non |  |  |
| auth | text | non |  |  |

## Vues

- `v_account_balances`
- `v_fund_balance`
- `v_invoice_balances`
- `v_project_finance`
- `v_stock_levels`
