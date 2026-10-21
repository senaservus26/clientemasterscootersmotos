# Ambiente de teste e atualização da produção

O sistema usa dois projetos Supabase separados. O de **teste** recebe toda mudança primeiro, com dados fictícios. O de **produção** só recebe a mudança depois que ela passou no teste e depois de um backup. As chaves de um nunca são usadas no outro.

## 1. Criar o projeto de teste no Supabase (uma vez)

1. Em supabase.com, crie um projeto novo chamado `masterscooter-teste`, região South America (São Paulo), plano gratuito.
2. No SQL Editor do projeto novo, rode `supabase-instalar.sql` (instalação inicial) e em seguida `supabase/atualizacoes/etapas-2-e-4.sql`.
3. Em Authentication > Email Templates > Magic Link, inclua `{{ .Token }}` no texto, igual à produção.
4. Em Authentication > URL Configuration, informe o endereço de prévia da Vercel (passo 2) como Site URL.

## 2. Prévia da Vercel usa o banco de teste

O `next.config.ts` faz toda prévia da Vercel (`VERCEL_ENV=preview`) usar a URL e a chave anon do projeto de teste, mesmo que as variáveis da Vercel apontem para a produção. A produção continua usando só as variáveis do ambiente Production. A faixa "ambiente de teste" aparece em toda prévia.

## 3. Primeiro administrador do teste

Entre na prévia com o seu e-mail uma vez. Depois, no SQL Editor do projeto de teste:

```sql
insert into public.perfis (id, papel, nome)
select id, 'admin', 'João' from auth.users where email = 'seu@email'
on conflict (id) do update set papel = excluded.papel, ativo = true;
```

Para testar os outros perfis, use outros e-mails (por exemplo um alias `seu+atendente@...` se o seu provedor aceitar) e defina o perfil em Painel > Equipe.

## 4. Aplicar na produção

Só depois de aprovar no teste:

1. **Backup**: no Supabase de produção, Database > Backups. No plano Pro há backup diário; antes de atualizar, confirme que existe um de hoje. No plano gratuito, exporte pelo terminal com `supabase db dump -f backup.sql` (Supabase CLI) e guarde o arquivo fora do computador.
2. Rode `supabase/atualizacoes/etapas-2-e-4.sql` no SQL Editor da produção. Se aparecer qualquer erro, nada foi alterado: copie a mensagem e envie à Sena SERVUS.
3. Faça o merge do pull request. A Vercel publica o site novo.
4. Confira: entrar como administrador, abrir Painel > Equipe, gerar um link de acompanhamento numa solicitação e abrir o link numa janela anônima.

O script recusa uma segunda execução (por exemplo, "type classe_prioridade already exists"). Isso é esperado e não altera nada.
