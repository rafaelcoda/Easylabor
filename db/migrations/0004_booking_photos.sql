-- 0004_booking_photos.sql — fotos do serviço no armazenamento do Supabase (bucket privado "booking-photos").
--
-- Convenção do caminho do arquivo:  <id do usuário que enviou>/<id do pedido>/<nome>.jpg
-- Quem pode enviar: só o profissional do pedido, enquanto o serviço está em execução, e só na própria pasta.
-- Quem pode ver: o cliente e o profissional do pedido, e a operação (admin).
-- As funções ficam no schema "private" (fora da API pública) e as regras de acesso só são criadas se o
-- schema "storage" existir (no Supabase), para esta migração também rodar em um PostgreSQL comum.

CREATE SCHEMA IF NOT EXISTS private;

-- Id do pedido, que é o 2º trecho do caminho. Devolve NULL se o caminho for inválido.
CREATE OR REPLACE FUNCTION private.photo_booking_id(object_name text) RETURNS uuid AS $$
DECLARE part text;
BEGIN
  part := split_part(object_name, '/', 2);
  IF part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN part::uuid; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

-- plpgsql de propósito: referencia auth.uid(), que só existe no Supabase.
CREATE OR REPLACE FUNCTION private.can_read_booking_photo(object_name text) RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = private.photo_booking_id(object_name)
      AND (
        b.client_id = auth.uid() OR b.professional_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin' AND u.status = 'active')
      )
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION private.can_upload_booking_photo(object_name text) RETURNS boolean AS $$
BEGIN
  RETURN split_part(object_name, '/', 1) = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = private.photo_booking_id(object_name) AND b.professional_id = auth.uid() AND b.status = 'in_progress'
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION private.can_read_booking_photo(text), private.can_upload_booking_photo(text) FROM PUBLIC;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('booking-photos', 'booking-photos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

    GRANT USAGE ON SCHEMA private TO authenticated;
    GRANT EXECUTE ON FUNCTION private.can_read_booking_photo(text), private.can_upload_booking_photo(text), private.photo_booking_id(text) TO authenticated;

    DROP POLICY IF EXISTS booking_photos_insert ON storage.objects;
    CREATE POLICY booking_photos_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'booking-photos' AND private.can_upload_booking_photo(name));

    DROP POLICY IF EXISTS booking_photos_select ON storage.objects;
    CREATE POLICY booking_photos_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'booking-photos' AND private.can_read_booking_photo(name));
  END IF;
END $$;
