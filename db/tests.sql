-- Testes de integridade do banco. Rodam dentro de uma transação que é revertida ao final.
\set ON_ERROR_STOP on
SET search_path TO public, extensions;
BEGIN;

-- ------------------------------------------------ dados de teste
INSERT INTO users (id, role, full_name, phone, accepted_terms_version, accepted_terms_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'client',       'Cliente Teste',      '+5527999990001', 'v1', now()),
  ('22222222-2222-2222-2222-222222222222', 'professional', 'Profissional Teste', '+5527999990002', 'v1', now());

INSERT INTO client_profiles (user_id, kind) VALUES ('11111111-1111-1111-1111-111111111111', 'person');

INSERT INTO professional_profiles (user_id, base_location, radius_km, kyc_status, pix_key, visible)
VALUES ('22222222-2222-2222-2222-222222222222', ST_SetSRID(ST_MakePoint(-40.2800, -20.2750), 4326)::geography, 10, 'approved', '12345678901', true);

INSERT INTO addresses (id, client_id, street, city, state, location)
VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Rua das Flores', 'Vitória', 'ES',
        ST_SetSRID(ST_MakePoint(-40.2785, -20.2731), 4326)::geography);

INSERT INTO service_offers (professional_id, category_id, daily_rate_cents)
SELECT '22222222-2222-2222-2222-222222222222', id, 20000 FROM service_categories WHERE slug = 'pintor';

INSERT INTO availabilities (professional_id, day, start_time, end_time)
VALUES ('22222222-2222-2222-2222-222222222222', DATE '2026-10-07', '06:00', '20:00');

CREATE FUNCTION pg_temp.new_booking(p_code text, p_start timestamptz, p_end timestamptz, p_status text) RETURNS uuid AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO bookings (code, client_id, requested_by, professional_id, category_id, address_id, starts_at, ends_at,
                        description, daily_rate_cents, client_fee_cents, commission_cents, status)
  SELECT p_code, '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
         '22222222-2222-2222-2222-222222222222', c.id, '33333333-3333-3333-3333-333333333333',
         p_start, p_end, 'Teste', 20000, 1000, 2400, p_status
  FROM service_categories c WHERE c.slug = 'pintor'
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------ 1. horários sobrepostos
DO $$
DECLARE b uuid;
BEGIN
  b := pg_temp.new_booking('T-1', '2026-10-07 11:00+00', '2026-10-07 19:00+00', 'accepted');

  BEGIN
    PERFORM pg_temp.new_booking('T-2', '2026-10-07 15:00+00', '2026-10-07 21:00+00', 'accepted');
    RAISE EXCEPTION 'esperava exclusion_violation para horários sobrepostos';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'ok  1a: dois pedidos aceitos sobrepostos são rejeitados';
  END;

  PERFORM pg_temp.new_booking('T-3', '2026-10-07 19:00+00', '2026-10-07 23:00+00', 'accepted');
  RAISE NOTICE 'ok  1b: pedidos aceitos em sequência (fim = início) são permitidos';

  PERFORM pg_temp.new_booking('T-4', '2026-10-07 12:00+00', '2026-10-07 18:00+00', 'requested');
  RAISE NOTICE 'ok  1c: pedido apenas solicitado pode sobrepor (só o aceito ocupa a agenda)';

  BEGIN
    PERFORM pg_temp.new_booking('T-5', '2026-10-08 11:00+00', '2026-10-08 11:30+00', 'requested');
    RAISE EXCEPTION 'esperava check_violation para duração de 30 min';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  1d: duração fora de 1 h a 12 h é rejeitada';
  END;

  BEGIN
    INSERT INTO bookings (code, client_id, requested_by, professional_id, category_id, address_id, starts_at, ends_at,
                          description, daily_rate_cents, client_fee_cents, commission_cents, status)
    SELECT 'T-6', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
           '22222222-2222-2222-2222-222222222222', c.id, '33333333-3333-3333-3333-333333333333',
           '2026-10-09 11:00+00', '2026-10-09 19:00+00', 'Teste', 20000, 1000, 2400, 'inventado'
    FROM service_categories c WHERE c.slug = 'pintor';
    RAISE EXCEPTION 'esperava check_violation para status inexistente';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  1e: status fora da máquina de estados é rejeitado';
  END;
END $$;

-- ------------------------------------------------ 2. ledger
DO $$
DECLARE tx uuid := gen_random_uuid(); b uuid;
BEGIN
  SELECT id INTO b FROM bookings WHERE code = 'T-1';

  INSERT INTO ledger_entries (transaction_id, account, direction, amount_cents, booking_id, reference_type, reference_id) VALUES
    (tx, 'bank',   'debit',  21000, b, 'payment', b),
    (tx, 'escrow', 'credit', 21000, b, 'payment', b);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  RAISE NOTICE 'ok  2a: lançamento balanceado é aceito';

  BEGIN
    INSERT INTO ledger_entries (transaction_id, account, direction, amount_cents, booking_id, reference_type, reference_id)
    VALUES (gen_random_uuid(), 'bank', 'debit', 100, b, 'payment', b);
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'esperava check_violation para lançamento desbalanceado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  2b: lançamento desbalanceado é rejeitado';
  END;

  BEGIN
    UPDATE ledger_entries SET amount_cents = 1 WHERE transaction_id = tx;
    RAISE EXCEPTION 'esperava restrict_violation no UPDATE do ledger';
  EXCEPTION WHEN restrict_violation THEN
    RAISE NOTICE 'ok  2c: ledger não aceita UPDATE';
  END;

  BEGIN
    DELETE FROM ledger_entries WHERE transaction_id = tx;
    RAISE EXCEPTION 'esperava restrict_violation no DELETE do ledger';
  EXCEPTION WHEN restrict_violation THEN
    RAISE NOTICE 'ok  2d: ledger não aceita DELETE';
  END;
END $$;

-- ------------------------------------------------ 3. tabelas somente de inserção e repasses
DO $$
DECLARE b uuid;
BEGIN
  SELECT id INTO b FROM bookings WHERE code = 'T-1';
  INSERT INTO booking_events (booking_id, type, from_status, to_status, actor_type) VALUES (b, 'booking.accepted', 'requested', 'accepted', 'professional');

  BEGIN
    UPDATE booking_events SET type = 'adulterado' WHERE booking_id = b;
    RAISE EXCEPTION 'esperava restrict_violation em booking_events';
  EXCEPTION WHEN restrict_violation THEN
    RAISE NOTICE 'ok  3a: histórico do pedido não pode ser alterado';
  END;

  BEGIN
    INSERT INTO payouts (professional_id, booking_id, type, gross_cents, commission_cents, advance_fee_cents, net_cents, status, scheduled_for)
    VALUES ('22222222-2222-2222-2222-222222222222', b, 'standard', 20000, 2400, 0, 18000, 'scheduled', now());
    RAISE EXCEPTION 'esperava check_violation: líquido deve ser diária − comissão − taxa';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  3b: repasse com líquido incorreto é rejeitado';
  END;

  INSERT INTO payouts (professional_id, booking_id, type, gross_cents, commission_cents, advance_fee_cents, net_cents, status, scheduled_for)
  VALUES ('22222222-2222-2222-2222-222222222222', b, 'standard', 20000, 2400, 0, 17600, 'scheduled', now());
  BEGIN
    INSERT INTO payouts (professional_id, booking_id, type, gross_cents, commission_cents, advance_fee_cents, net_cents, status, scheduled_for)
    VALUES ('22222222-2222-2222-2222-222222222222', b, 'standard', 20000, 2400, 0, 17600, 'scheduled', now());
    RAISE EXCEPTION 'esperava unique_violation: um repasse padrão por pedido';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok  3c: só um repasse padrão por pedido';
  END;
END $$;

-- ------------------------------------------------ 4. busca por proximidade (especificação 3.6)
DO $$
DECLARE n int; d numeric;
BEGIN
  SELECT count(*), min(ST_Distance(p.base_location, a.location))
    INTO n, d
  FROM professional_profiles p
  JOIN service_offers o ON o.professional_id = p.user_id AND o.active
  JOIN service_categories c ON c.id = o.category_id AND c.slug = 'pintor'
  JOIN availabilities av ON av.professional_id = p.user_id AND av.day = DATE '2026-10-07' AND av.status = 'free'
  JOIN users u ON u.id = p.user_id AND u.status = 'active'
  JOIN addresses a ON a.id = '33333333-3333-3333-3333-333333333333'
  WHERE p.kyc_status = 'approved' AND p.visible
    AND ST_DWithin(p.base_location, a.location, p.radius_km * 1000);
  IF n <> 1 THEN RAISE EXCEPTION 'busca deveria achar 1 profissional, achou %', n; END IF;
  IF d > 500 THEN RAISE EXCEPTION 'distância esperada < 500 m, veio % m', d; END IF;
  RAISE NOTICE 'ok  4a: busca por proximidade acha o profissional a % m', round(d);

  UPDATE professional_profiles SET radius_km = 1 WHERE user_id = '22222222-2222-2222-2222-222222222222';
  UPDATE professional_profiles SET base_location = ST_SetSRID(ST_MakePoint(-40.40, -20.40), 4326)::geography
   WHERE user_id = '22222222-2222-2222-2222-222222222222';
  SELECT count(*) INTO n
  FROM professional_profiles p JOIN addresses a ON a.id = '33333333-3333-3333-3333-333333333333'
  WHERE ST_DWithin(p.base_location, a.location, p.radius_km * 1000);
  IF n <> 0 THEN RAISE EXCEPTION 'profissional fora do raio não deveria aparecer'; END IF;
  RAISE NOTICE 'ok  4b: profissional fora do raio de atuação não aparece';
END $$;

-- ------------------------------------------------ 5. seed
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM service_categories;
  IF n < 3 THEN RAISE EXCEPTION 'seed deveria ter 3 categorias, tem %', n; END IF;
  SELECT count(*) INTO n FROM config_settings WHERE key = 'commission_bps' AND value = '1200';
  IF n <> 1 THEN RAISE EXCEPTION 'config commission_bps ausente'; END IF;
  RAISE NOTICE 'ok  5 : seed com categorias e parâmetros do PRD';
END $$;

ROLLBACK;
\echo TODOS OS TESTES DE BANCO PASSARAM
