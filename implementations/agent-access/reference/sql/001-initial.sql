CREATE TABLE IF NOT EXISTS schema_versions (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS service_policies (namespace text PRIMARY KEY,current_version integer NOT NULL CHECK(current_version>0));
CREATE TABLE IF NOT EXISTS principals (
 id text PRIMARY KEY, namespace text NOT NULL, issuer text NOT NULL, subject text NOT NULL,
 client_id text NOT NULL, jkt text NOT NULL, display_name text NOT NULL,
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_used_at timestamptz,
 UNIQUE(namespace,issuer,subject,client_id,jkt), UNIQUE(id,namespace)
);
CREATE TABLE IF NOT EXISTS grants (
 id text PRIMARY KEY, principal_id text NOT NULL REFERENCES principals(id),
 max_total_cents integer NOT NULL CHECK(max_total_cents BETWEEN 1 AND 50000),
 scopes text[] NOT NULL, active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(id,principal_id)
);
CREATE TABLE IF NOT EXISTS enrollments (
 id text PRIMARY KEY, namespace text NOT NULL, issuer text NOT NULL, subject text NOT NULL,
 client_id text NOT NULL, jkt text NOT NULL, display_name text NOT NULL,
 max_total_cents integer NOT NULL CHECK(max_total_cents BETWEEN 1 AND 50000), scopes text[] NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','expired')),
 principal_id text REFERENCES principals(id), grant_id text REFERENCES grants(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 CHECK(expires_at>created_at), CHECK((status='confirmed')=(principal_id IS NOT NULL AND grant_id IS NOT NULL)),
 CHECK((principal_id IS NULL)=(grant_id IS NULL)),
 FOREIGN KEY(principal_id,namespace) REFERENCES principals(id,namespace),
 FOREIGN KEY(grant_id,principal_id) REFERENCES grants(id,principal_id)
);
CREATE TABLE IF NOT EXISTS offers (
 id text PRIMARY KEY, version integer NOT NULL DEFAULT 1 CHECK(version>0), title text NOT NULL,
 unit_price_cents integer NOT NULL CHECK(unit_price_cents>=0), fee_cents integer NOT NULL DEFAULT 0 CHECK(fee_cents>=0),
 currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'), refundable boolean NOT NULL,
 terms text NOT NULL, stock integer NOT NULL CHECK(stock>=0)
);
CREATE TABLE IF NOT EXISTS operations (
 id text PRIMARY KEY, namespace text NOT NULL, principal_id text NOT NULL REFERENCES principals(id),
 grant_id text NOT NULL REFERENCES grants(id), offer_id text NOT NULL REFERENCES offers(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), snapshot jsonb NOT NULL, snapshot_digest text NOT NULL CHECK(snapshot_digest~'^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN ('awaiting_approval','ready','succeeded','cancelled','expired','superseded','failed')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 CHECK(expires_at>created_at), CHECK(status<>'succeeded' OR result IS NOT NULL),
 UNIQUE(id,namespace,principal_id), UNIQUE(id,offer_id),
 FOREIGN KEY(principal_id,namespace) REFERENCES principals(id,namespace),
 FOREIGN KEY(grant_id,principal_id) REFERENCES grants(id,principal_id)
);
CREATE TABLE IF NOT EXISTS reviews (
 id text PRIMARY KEY, operation_id text NOT NULL UNIQUE REFERENCES operations(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','opened','in_progress','completed','expired','cancelled')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), result jsonb, reviewer jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 completed_at timestamptz, cancelled_at timestamptz,
 CHECK(expires_at>created_at), CHECK((status='completed')=(result IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS review_capabilities (
 token_hash text PRIMARY KEY CHECK(token_hash~'^[a-f0-9]{64}$'), review_id text NOT NULL REFERENCES reviews(id),
 purpose text NOT NULL DEFAULT 'review' CHECK(purpose='review'), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS idempotency (
 namespace text NOT NULL, principal_id text NOT NULL REFERENCES principals(id), endpoint text NOT NULL,
 key text NOT NULL, fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 operation_id text NOT NULL UNIQUE REFERENCES operations(id),
 PRIMARY KEY(namespace,principal_id,endpoint,key),
 FOREIGN KEY(operation_id,namespace,principal_id) REFERENCES operations(id,namespace,principal_id)
);
CREATE TABLE IF NOT EXISTS bookings (
 id text PRIMARY KEY, operation_id text NOT NULL UNIQUE REFERENCES operations(id),
 offer_id text NOT NULL REFERENCES offers(id), quantity integer NOT NULL CHECK(quantity>0),
 total_cents integer NOT NULL CHECK(total_cents BETWEEN 0 AND 50000), currency text NOT NULL CHECK(currency='EUR'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(operation_id,offer_id) REFERENCES operations(id,offer_id)
);
CREATE TABLE IF NOT EXISTS replays (
 namespace text NOT NULL, key text NOT NULL, id text NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(namespace,key,id)
);
CREATE TABLE IF NOT EXISTS nonces (
 jkt text NOT NULL, nonce_hash text NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(jkt,nonce_hash)
);
CREATE TABLE IF NOT EXISTS quotas (
 key text NOT NULL, window_start timestamptz NOT NULL, count integer NOT NULL CHECK(count>0),
 PRIMARY KEY(key,window_start)
);
CREATE TABLE IF NOT EXISTS browser_sessions (
 token_hash text PRIMARY KEY, identity jsonb, csrf_hash text NOT NULL,
 review_ids text[] NOT NULL DEFAULT '{}', expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS oidc_states (
 state_hash text PRIMARY KEY, session_hash text NOT NULL REFERENCES browser_sessions(token_hash),
 verifier text NOT NULL, nonce text NOT NULL, return_path text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event text NOT NULL,
 principal_id text REFERENCES principals(id), operation_id text REFERENCES operations(id),
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS replays_expiry ON replays(expires_at);
CREATE INDEX IF NOT EXISTS nonces_expiry ON nonces(expires_at);
CREATE INDEX IF NOT EXISTS operations_principal ON operations(principal_id);
CREATE INDEX IF NOT EXISTS audit_operation ON audit_events(operation_id);
CREATE TABLE IF NOT EXISTS directory_cache(identifier text PRIMARY KEY, payload jsonb, failed boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL, refreshed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS directory_leases(identifier text PRIMARY KEY, owner text NOT NULL, expires_at timestamptz NOT NULL);
CREATE OR REPLACE FUNCTION immutable_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.snapshot_digest IS DISTINCT FROM OLD.snapshot_digest
 OR NEW.principal_id IS DISTINCT FROM OLD.principal_id OR NEW.grant_id IS DISTINCT FROM OLD.grant_id
 OR NEW.offer_id IS DISTINCT FROM OLD.offer_id OR NEW.namespace IS DISTINCT FROM OLD.namespace
 OR NEW.version IS DISTINCT FROM OLD.version OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
  RAISE EXCEPTION 'operation binding is immutable';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS operations_immutable ON operations;
CREATE TRIGGER operations_immutable BEFORE UPDATE ON operations FOR EACH ROW EXECUTE FUNCTION immutable_operation();
CREATE OR REPLACE FUNCTION revision_offer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.title,NEW.unit_price_cents,NEW.fee_cents,NEW.currency,NEW.refundable,NEW.terms)
 IS DISTINCT FROM ROW(OLD.title,OLD.unit_price_cents,OLD.fee_cents,OLD.currency,OLD.refundable,OLD.terms) THEN
  NEW.version=OLD.version+1;
 ELSIF NEW.version<OLD.version THEN RAISE EXCEPTION 'offer revision cannot decrease'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS offers_revision ON offers;
CREATE TRIGGER offers_revision BEFORE UPDATE ON offers FOR EACH ROW EXECUTE FUNCTION revision_offer();
CREATE OR REPLACE FUNCTION revision_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.principal_id IS DISTINCT FROM OLD.principal_id THEN RAISE EXCEPTION 'grant owner is immutable'; END IF;
 IF ROW(NEW.max_total_cents,NEW.scopes,NEW.active) IS DISTINCT FROM ROW(OLD.max_total_cents,OLD.scopes,OLD.active) THEN
  NEW.version=OLD.version+1;
 ELSIF NEW.version<OLD.version THEN RAISE EXCEPTION 'grant revision cannot decrease'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS grants_revision ON grants;
CREATE TRIGGER grants_revision BEFORE UPDATE ON grants FOR EACH ROW EXECUTE FUNCTION revision_grant();
CREATE OR REPLACE FUNCTION immutable_principal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.namespace,NEW.issuer,NEW.subject,NEW.client_id,NEW.jkt,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.namespace,OLD.issuer,OLD.subject,OLD.client_id,OLD.jkt,OLD.created_at)
 THEN RAISE EXCEPTION 'principal identity is immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS principals_immutable ON principals;
CREATE TRIGGER principals_immutable BEFORE UPDATE ON principals FOR EACH ROW EXECUTE FUNCTION immutable_principal();
CREATE OR REPLACE FUNCTION immutable_review_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.operation_id,NEW.created_at,NEW.expires_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.operation_id,OLD.created_at,OLD.expires_at)
 THEN RAISE EXCEPTION 'review binding is immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reviews_immutable_binding ON reviews;
CREATE TRIGGER reviews_immutable_binding BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION immutable_review_binding();
CREATE OR REPLACE FUNCTION immutable_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (TG_TABLE_NAME='reviews' AND OLD.status IN ('completed','expired','cancelled'))
 OR (TG_TABLE_NAME='operations' AND OLD.status IN ('succeeded','cancelled','expired','superseded','failed')) THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'terminal result is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reviews_terminal ON reviews;
CREATE TRIGGER reviews_terminal BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION immutable_terminal();
DROP TRIGGER IF EXISTS operations_terminal ON operations;
CREATE TRIGGER operations_terminal BEFORE UPDATE ON operations FOR EACH ROW EXECUTE FUNCTION immutable_terminal();
INSERT INTO schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;
