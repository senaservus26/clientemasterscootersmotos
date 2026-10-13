import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { exigirVariavel } from './env';

export async function supabaseServidor() {
  const cookieStore = await cookies();
  return createServerClient(exigirVariavel('NEXT_PUBLIC_SUPABASE_URL'), exigirVariavel('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (lista) => {
        try {
          lista.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // chamado de um Server Component: o middleware renova a sessão
        }
      },
    },
  });
}
