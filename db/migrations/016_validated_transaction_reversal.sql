CREATE OR REPLACE FUNCTION protect_validated_tx() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('validated','reversed') THEN
      RAISE EXCEPTION 'Transaction validée: suppression interdite, utiliser une contre-passation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('validated','reversed') THEN
    IF OLD.status = 'validated' AND NEW.status = 'reversed'
       AND (to_jsonb(NEW) - 'status' - 'updated_at' - 'amount_usd')
         = (to_jsonb(OLD) - 'status' - 'updated_at' - 'amount_usd') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Transaction validée: modification interdite, utiliser une contre-passation';
  END IF;
  RETURN NEW;
END $$;
