CREATE OR REPLACE FUNCTION forbid_history_change() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only; record a reversal/adjustment instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
