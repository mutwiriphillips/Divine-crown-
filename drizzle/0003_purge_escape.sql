-- The append-only guards can be lifted for one transaction by the demo-data purge script only:
--   SET LOCAL app.allow_purge = 'on';
-- Normal application code never sets this.
CREATE OR REPLACE FUNCTION forbid_history_change() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_purge', true) = 'on' THEN
    RETURN COALESCE(OLD, NEW);
  END IF;
  RAISE EXCEPTION '% is append-only; record a reversal/adjustment instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_payment_update() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_purge', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments cannot be deleted; reverse them instead';
  END IF;
  IF NEW.amount_cents <> OLD.amount_cents OR NEW.order_id <> OLD.order_id OR NEW.method <> OLD.method
     OR NEW.reference IS DISTINCT FROM OLD.reference OR NEW.received_at <> OLD.received_at THEN
    RAISE EXCEPTION 'payment details are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_document_update() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_purge', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'issued documents cannot be deleted';
  END IF;
  IF NEW.snapshot::text <> OLD.snapshot::text OR NEW.number <> OLD.number OR NEW.type <> OLD.type THEN
    RAISE EXCEPTION 'issued documents are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
