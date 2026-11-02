-- Lot 9 : affaires, pipeline, partenaires, relances et rapports

CREATE TABLE IF NOT EXISTS opportunity_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  remind_on date NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, remind_on, note)
);

GRANT SELECT, INSERT, UPDATE ON customers, customer_contacts, customer_interactions, opportunities, opportunity_stage_history, suppliers, partners TO mojo_app;
GRANT SELECT, INSERT, UPDATE ON opportunity_reminders TO mojo_app;
