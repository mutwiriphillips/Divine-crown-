-- Append-only guards: history tables can be inserted into but never edited or deleted.
CREATE OR REPLACE FUNCTION forbid_history_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; record a reversal/adjustment instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
-- Payments: amount, order, method and reference are frozen; only reversal fields may change, and rows are never deleted.
CREATE OR REPLACE FUNCTION guard_payment_update() RETURNS trigger AS $$
BEGIN
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
CREATE TRIGGER payments_guard BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION guard_payment_update();
--> statement-breakpoint
-- Issued documents keep their snapshot and number forever; only print counters may change.
CREATE OR REPLACE FUNCTION guard_document_update() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'issued documents cannot be deleted';
  END IF;
  IF NEW.snapshot::text <> OLD.snapshot::text OR NEW.number <> OLD.number OR NEW.type <> OLD.type THEN
    RAISE EXCEPTION 'issued documents are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER documents_guard BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION guard_document_update();
--> statement-breakpoint
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
ALTER TABLE categories ADD CONSTRAINT categories_parent_fk FOREIGN KEY (parent_id) REFERENCES categories(id);
--> statement-breakpoint
CREATE INDEX products_search_idx ON products USING gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(brand,'')));
