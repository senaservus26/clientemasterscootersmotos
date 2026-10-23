import type { NextConfig } from 'next';

// As prévias da Vercel (um endereço por pull request) usam sempre o Supabase de TESTE, nunca o de produção.
// URL e chave anon são públicas por natureza (vão para o navegador); a chave service_role nunca entra aqui.
const SUPABASE_TESTE = {
  url: 'https://lqvogcmzgadflqefhgod.supabase.co',
  anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxxdm9nY216Z2FkZmxxZWZoZ29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MjI2MjksImV4cCI6MjEwODE5ODYyOX0.u7UuAnFE7n3CGC7yUxQcPtcBg_iDadAOnREV6G-xLiI',
};
if (process.env.VERCEL_ENV === 'preview') {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_TESTE.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SUPABASE_TESTE.anon;
  delete process.env.NEXT_PUBLIC_AMBIENTE;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
};

export default nextConfig;
