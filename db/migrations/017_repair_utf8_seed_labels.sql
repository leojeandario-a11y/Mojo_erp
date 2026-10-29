UPDATE app_settings
SET description = convert_from(convert_to(description, 'WIN1252'), 'UTF8')
WHERE description ~ '[ÃÂ├┬]';

UPDATE approval_workflow_steps
SET label = convert_from(convert_to(label, 'WIN1252'), 'UTF8')
WHERE label ~ '[ÃÂ├┬]';

UPDATE approval_workflows
SET name = convert_from(convert_to(name, 'WIN1252'), 'UTF8')
WHERE name ~ '[ÃÂ├┬]';

UPDATE currencies
SET name = convert_from(convert_to(name, 'WIN1252'), 'UTF8')
WHERE name ~ '[ÃÂ├┬]';

UPDATE departments
SET name = convert_from(convert_to(name, 'WIN1252'), 'UTF8')
WHERE name ~ '[ÃÂ├┬]';

UPDATE leave_types
SET name = convert_from(convert_to(name, 'WIN1252'), 'UTF8')
WHERE name ~ '[ÃÂ├┬]';

UPDATE roles
SET name = convert_from(convert_to(name, 'WIN1252'), 'UTF8')
WHERE name ~ '[ÃÂ├┬]';