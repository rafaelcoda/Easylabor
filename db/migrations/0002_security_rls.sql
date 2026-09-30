-- 0002_security_rls.sql — Row Level Security.
-- No Supabase, tabelas do schema public ficam expostas à API com a chave pública (anon).
-- Com RLS ligado e SEM políticas, anon e authenticated não leem nem escrevem nada;
-- somente a API do servidor (chave service_role, que ignora RLS) acessa os dados.
-- Políticas por perfil (leitura dos próprios pedidos, perfil público do profissional etc.)
-- entram junto com a API, na sprint 2.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
