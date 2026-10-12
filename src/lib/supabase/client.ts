'use client';
import { createBrowserClient } from '@supabase/ssr';
import { exigirVariavel } from './env';

export function supabaseNavegador() {
  return createBrowserClient(exigirVariavel('NEXT_PUBLIC_SUPABASE_URL'), exigirVariavel('NEXT_PUBLIC_SUPABASE_ANON_KEY'));
}
