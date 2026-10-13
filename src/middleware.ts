import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Renova a sessão a cada requisição e protege a área do cliente e o painel.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !chave) return response;

  const supabase = createServerClient(url, chave, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista) => {
        lista.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        lista.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && (request.nextUrl.pathname.startsWith('/cliente') || request.nextUrl.pathname.startsWith('/painel'))) {
    const destino = request.nextUrl.clone();
    destino.pathname = '/entrar';
    return NextResponse.redirect(destino);
  }
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png).*)'] };
