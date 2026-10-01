/** @type {import('next').NextConfig} */
const nextConfig = {
  // Site 100% estático: toda a lógica roda no navegador, falando com a API e com o Supabase Auth.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // Permite importar o cliente compartilhado de ../../packages/client.
  experimental: { externalDir: true },
};
export default nextConfig;
