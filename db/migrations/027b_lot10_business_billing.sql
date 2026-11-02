CREATE SEQUENCE IF NOT EXISTS invoice_numbers;
GRANT SELECT, USAGE ON SEQUENCE invoice_numbers TO mojo_app;
GRANT SELECT, INSERT, UPDATE ON contracts, contract_milestones, invoices, invoice_items, invoice_payments TO mojo_app;
