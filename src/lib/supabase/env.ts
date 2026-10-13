const valores: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

export function exigirVariavel(nome: keyof typeof valores & string): string {
  const v = valores[nome];
  if (!v) throw new Error(`Variável de ambiente ${nome} não configurada. Veja .env.example.`);
  return v;
}
