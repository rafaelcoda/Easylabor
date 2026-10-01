-- 0005_weekly_availability.sql — disponibilidade semanal do profissional.
--
-- O profissional marca os dias da semana em que atende (1 = segunda ... 7 = domingo) e um horário.
-- A API transforma isso em linhas em `availabilities` para os próximos 28 dias (e uma rotina diária estende o prazo),
-- então a busca continua olhando só para `availabilities`. `source` diferencia o que veio do modelo semanal
-- do que o profissional ajustou à mão num dia específico (esse nunca é sobrescrito).

ALTER TABLE professional_profiles
  ADD COLUMN weekly_days smallint[] NOT NULL DEFAULT '{}',
  ADD COLUMN weekly_start time,
  ADD COLUMN weekly_end time,
  ADD CONSTRAINT weekly_days_valid CHECK (weekly_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  ADD CONSTRAINT weekly_range_valid CHECK (weekly_start IS NULL OR weekly_end IS NULL OR weekly_end > weekly_start);

ALTER TABLE availabilities
  ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'weekly'));
