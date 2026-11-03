BEGIN;

ALTER TABLE users
  ADD COLUMN profile_photo_data bytea,
  ADD COLUMN profile_photo_mime text,
  ADD CONSTRAINT users_profile_photo_size_check
    CHECK (profile_photo_data IS NULL OR octet_length(profile_photo_data) <= 2097152),
  ADD CONSTRAINT users_profile_photo_mime_check
    CHECK (profile_photo_mime IS NULL OR profile_photo_mime IN ('image/jpeg', 'image/png')),
  ADD CONSTRAINT users_profile_photo_pair_check
    CHECK ((profile_photo_data IS NULL) = (profile_photo_mime IS NULL));

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid text;
BEGIN
  IF TG_OP = 'DELETE' THEN rid := (to_jsonb(OLD)->>'id'); ELSE rid := (to_jsonb(NEW)->>'id'); END IF;
  INSERT INTO audit_logs(user_id, ip_address, module, action, table_name, record_id, old_values, new_values)
  VALUES (app_user_id(), NULLIF(current_setting('app.ip', true), ''), TG_ARGV[0], TG_OP, TG_TABLE_NAME, rid,
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) - 'password_hash' - 'mfa_secret' - 'profile_photo_data' - 'profile_photo_mime' END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) - 'password_hash' - 'mfa_secret' - 'profile_photo_data' - 'profile_photo_mime' END
  );
  RETURN COALESCE(NEW, OLD);
END $$;

COMMIT;
