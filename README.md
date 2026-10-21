# Plataforma Master Scooter Motos

Plataforma digital da Master Scooter Motos (Praia Grande/SP), desenvolvida pela Sena SERVUS. Ela reúne o site, a área do cliente, a agenda e o painel da oficina, com uma única base de dados.

Stack: Next.js 15 (App Router) + TypeScript, Supabase (PostgreSQL, login e armazenamento) e hospedagem na Vercel.

## Situação atual (até a Etapa 4)

| Parte | Situação |
| --- | --- |
| Banco de dados: tabelas, migração, dados iniciais | Pronto e testado num PostgreSQL 16 real |
| Regras no banco: protocolo, prioridade só pelo especialista, agenda sem conflito, capacidade, bloqueios, auditoria | Pronto e testado (ver `tests/db`) |
| Segurança por linha (RLS): cada cliente vê só os próprios dados; notas internas só para a equipe | Pronto e testado |
| Login sem senha por código de e-mail | Código pronto; depende do projeto Supabase para funcionar |
| Área do cliente: cadastro, scooter, solicitação, protocolo, andamento, escolha de horário | Código pronto e compilando; depende do projeto Supabase |
| Painel da oficina (`/painel`): fila por prioridade e risco, triagem, notas internas, confirmação e cancelamento de horário | Código pronto e compilando; depende do projeto Supabase |
| Agenda do dia por box, ocupação, preferências dos clientes e bloqueios de horário (`/painel/agenda`) | Código pronto e compilando; depende do projeto Supabase |
| Modelo da Etapa 2: ordem de serviço, orçamento por itens, aprovação do cliente, pagamento, triagem com prioridade sugerida e confirmada, lista de espera, recomendações, linha do tempo da moto, fila de mensagens com modo de teste (`supabase/migrations/20261021000100_modelo_etapa2.sql`) | Estrutura pronta e testada (ver `tests/db/modelo.test.mjs`); ainda sem telas nem funções de gravação, que chegam nas Etapas 4 a 10. Não aplicado no Supabase publicado |
| Etapa 4, perfis de acesso: tela Equipe só para o administrador (incluir, trocar perfil, desativar), página para acesso desativado, link de acompanhamento sem login com validade de 30 dias (`/p/...`), sempre um administrador ativo (`supabase/migrations/20261022000100_etapa4_acesso.sql`) | Banco testado (ver `tests/db/acesso.test.mjs`); telas compilando; depende de aplicar `supabase/atualizacoes/etapas-2-e-4.sql` no Supabase |
| Fotos e vídeos na solicitação | Tabela de anexos pronta; envio com armazenamento privado na Etapa 5 |
| WhatsApp | Entrega E6; nada integrado ainda |

Os serviços e o horário vêm do Instagram @masterscootermotos e ainda precisam ser confirmados pela oficina. Durações, boxes, capacidade diária e lista de sintomas de risco são estimativas da Sena SERVUS (ver `supabase/seed.sql`).

## Estrutura

```
supabase/migrations/   estrutura do banco, regras e permissões (aplicar em ordem)
supabase/seed.sql      dados iniciais da oficina
src/app/               páginas (início, entrar, área do cliente, painel da oficina)
src/lib/               validação dos formulários, acesso ao Supabase, rótulos
tests/unit/            testes da validação
tests/db/              testes das regras do banco num PostgreSQL real
```

## Como rodar os testes

Requer Node 22 e um PostgreSQL 16 acessível.

```bash
npm ci
TEST_PG_HOST=localhost TEST_PG_PORT=5432 TEST_PG_USER=postgres TEST_PG_PASSWORD=postgres npm test
```

Os testes criam e apagam os bancos `masterscooter_teste`, `masterscooter_modelo` e `masterscooter_acesso`. O arquivo `tests/db/supabase-shim.sql` simula os papéis e a função `auth.uid()` do Supabase; ele não é aplicado no Supabase real. O GitHub Actions roda os mesmos testes a cada envio (`.github/workflows/testes.yml`).

## Como colocar no ar

1. **Criar o projeto no Supabase** na região South America (São Paulo). Use o plano gratuito nos testes e o Pro em produção, por causa do backup diário.
2. **Aplicar o banco**: no painel do Supabase, abra o SQL Editor e rode, nesta ordem, o arquivo de `supabase/migrations/` e depois `supabase/seed.sql`. Com a Supabase CLI, `supabase link` e `supabase db push` fazem o mesmo.
3. **Ativar o código por e-mail**: em Authentication > Email Templates > Magic Link, inclua `{{ .Token }}` no texto, para o cliente receber o código de 6 dígitos. Em produção, configure um SMTP próprio (por exemplo Resend), porque o envio padrão do Supabase tem limite baixo.
4. **Variáveis de ambiente**: copie `.env.example` para `.env.local` (local) e cadastre as mesmas variáveis na Vercel. Só a chave pública (anon) entra no site. A chave `service_role` nunca vai para o código.
5. **Criar a equipe**: cada pessoa entra uma vez pelo site com o próprio e-mail. O primeiro administrador é definido uma única vez no SQL Editor:

   ```sql
   insert into public.perfis (id, papel, nome)
   select id, 'admin', 'Nome da pessoa' from auth.users where email = 'email@da-pessoa'
   on conflict (id) do update set papel = excluded.papel, ativo = true;
   ```

   Depois disso, o administrador inclui e gerencia as demais pessoas em **Painel > Equipe**. Perfis: administrador, atendente, especialista.
6. **Publicar na Vercel**: importe o repositório, informe as variáveis e publique. Defina `NEXT_PUBLIC_AMBIENTE=producao` só no ambiente de produção, para esconder a faixa de testes.

## Atualizar um banco que já está no ar

Banco instalado antes da Etapa 2: rode `supabase/atualizacoes/etapas-2-e-4.sql` inteiro no SQL Editor. Ele roda numa transação, então ou aplica tudo ou não muda nada. Rode antes no projeto de teste e faça o backup da produção antes de aplicar nela. O passo a passo está em `docs/ambiente-de-teste.md`.

## Decisões de projeto

- **As regras ficam no banco.** Site, painel e chatbot chamam as mesmas funções (`registrar_cliente`, `criar_solicitacao`, `horarios_disponiveis`, `indicar_preferencia`, `atualizar_triagem`, `confirmar_agendamento`, `cancelar_agendamento`). Ninguém grava solicitação ou agendamento direto nas tabelas.
- **Agendamento sem conflito em três camadas.** A vitrine mostra só horários livres. A confirmação trava o dia e revalida tudo. Por fim, uma restrição de exclusão do PostgreSQL impede dois compromissos no mesmo box e horário, mesmo com duas confirmações simultâneas.
- **Prioridade é decisão humana.** Só o especialista ou o administrador grava a prioridade, e um gatilho no banco garante isso. Sintomas marcados como risco apenas exibem uma orientação de segurança e destacam o pedido.
- **LGPD.** O sistema coleta só o necessário. Os aceites ficam registrados com a versão do texto, as notas internas são separadas do que o cliente vê, e toda alteração em clientes, solicitações, agendamentos e bloqueios entra na auditoria.
