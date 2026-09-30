-- Dados iniciais de exemplo. As faixas de preço são PLACEHOLDERS: substituir pelos valores reais da cidade piloto.
INSERT INTO service_categories (slug, name, min_daily_rate_cents, max_daily_rate_cents, required_documents, checklist, min_photos_checkout) VALUES
  ('diarista',       'Diarista',       10000, 25000, '{}', '["Limpeza geral","Cozinha e banheiros","Organização"]', 1),
  ('ajudante-geral', 'Ajudante geral', 10000, 22000, '{}', '["Carga e descarga","Limpeza da área"]', 1),
  ('pintor',         'Pintor',         15000, 35000, '{}', '["Proteger móveis e piso","Aplicação da tinta","Limpeza final"]', 2)
ON CONFLICT (slug) DO NOTHING;

-- Parâmetros do PRD (valores em pontos-base e minutos). Espelham DEFAULT_CONFIG de @diaria/core.
INSERT INTO config_settings (key, value) VALUES
  ('client_fee_bps', '500'), ('commission_bps', '1200'), ('advance_fee_bps', '300'),
  ('accept_deadline_minutes', '15'), ('accept_deadline_short_minutes', '5'), ('max_resend_attempts', '3'),
  ('pix_expiry_minutes', '30'), ('late_alert_minutes', '30'), ('no_show_minutes', '60'),
  ('check_in_radius_meters', '300'), ('auto_approve_hours', '24'), ('payout_delay_hours', '48')
ON CONFLICT (key, scope) DO NOTHING;
