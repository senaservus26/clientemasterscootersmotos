-- Master Scooter Motos · atualização para as Etapas 2 e 4
-- Para um banco que já tem a instalação inicial (supabase-instalar.sql). Rode inteiro no SQL Editor.
-- Tudo roda numa transação: se qualquer parte falhar, nada é alterado.
-- Rode primeiro no projeto de TESTE. Em produção, só depois de fazer o backup.

begin;

-- ===== Etapa 2: modelo de dados
-- Master Scooter Motos · modelo de dados da Etapa 2 (prompt mestre)
-- Só acrescenta estrutura: nada do que o site publicado usa é removido ou renomeado.
-- A troca dos status e da prioridade antiga acontece junto com o código das Etapas 5 e 6.
-- As funções que gravam nestas tabelas (abrir OS, orçar, aprovar, pagar) chegam nas próximas etapas;
-- até lá, o site só lê, sempre filtrado pelo RLS.

-- ---------------------------------------------------------------- tipos
create type public.classe_prioridade as enum ('emergencial', 'prioritaria', 'programavel', 'preventiva');
create type public.estado_os as enum (
  'aberta', 'em_diagnostico', 'aguardando_aprovacao', 'em_execucao', 'pronta', 'entregue', 'cancelada'
);
create type public.estado_item_os as enum ('proposto', 'aprovado', 'recusado', 'executado');

-- ---------------------------------------------------------------- cadastro
alter table public.veiculos
  add column ano_modelo smallint check (ano_modelo between 1980 and 2101),
  add column historico_informado text check (length(historico_informado) <= 2000),
  add column observacoes text check (length(observacoes) <= 1000);
alter table public.veiculos add constraint veiculos_ano_modelo_coerente
  check (ano_modelo is null or ano_modelo between ano and ano + 1);

-- quem cadastrou o cliente: o próprio cliente (site) ou a equipe (balcão, telefone)
alter table public.clientes
  add column cadastrado_por uuid references public.perfis (id),
  add column canal_cadastro text not null default 'site' check (canal_cadastro in ('site', 'balcao', 'telefone', 'whatsapp'));

-- acompanhamento sem login: o cliente sem e-mail recebe um link com token; só o hash fica no banco
create table public.acessos_protocolo (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes (id) on delete cascade,
  token_hash bytea not null unique check (length(token_hash) = 32),
  expira_em timestamptz not null,
  revogado_em timestamptz,
  criado_por uuid references public.perfis (id),
  criado_em timestamptz not null default now(),
  check (expira_em > criado_em)
);

-- ---------------------------------------------------------------- solicitação e triagem
alter table public.sintomas add column classe_sugerida public.classe_prioridade;
alter table public.servicos add column exige_avaliacao boolean not null default true;

create table public.anexos (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes (id) on delete cascade,
  momento text not null check (momento in ('solicitacao', 'recepcao', 'execucao', 'entrega')),
  caminho text not null unique check (caminho ~ '^[a-z0-9/_.-]+$'), -- bucket privado do Storage
  tipo text not null check (tipo in ('foto', 'video')),
  tamanho_bytes integer not null check (tamanho_bytes between 1 and 52428800),
  enviado_por uuid,
  criado_em timestamptz not null default now()
);
create index anexos_solicitacao_idx on public.anexos (solicitacao_id);

-- cada avaliação fica registrada; a mais recente vale. A sugestão automática nunca é a decisão.
create table public.triagens (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes (id) on delete cascade,
  prioridade_sugerida public.classe_prioridade not null,
  criterio_sugestao text not null,
  prioridade_confirmada public.classe_prioridade,
  justificativa text check (length(justificativa) <= 1000),
  avaliado_por uuid references public.perfis (id),
  avaliado_em timestamptz,
  criado_em timestamptz not null default now(),
  constraint triagem_confirmada_completa check (
    prioridade_confirmada is null
    or (coalesce(length(btrim(justificativa)), 0) >= 5 and avaliado_por is not null and avaliado_em is not null)
  )
);
create index triagens_solicitacao_idx on public.triagens (solicitacao_id, criado_em desc);

-- regra da sugestão: sintoma de risco > classe do sintoma > serviço preventivo > programável
create function app.sugerir_prioridade(p_sintomas text[], p_servico_slug text)
returns table (classe public.classe_prioridade, criterio text)
language sql stable security definer set search_path = '' as $$
  select coalesce(
           (select 'emergencial'::public.classe_prioridade from public.sintomas s where s.slug = any(p_sintomas) and s.risco limit 1),
           (select s.classe_sugerida from public.sintomas s where s.slug = any(p_sintomas) and s.classe_sugerida is not null
              order by s.classe_sugerida limit 1),
           case when p_servico_slug = 'revisao-geral' then 'preventiva'::public.classe_prioridade end,
           'programavel'),
         case
           when exists (select 1 from public.sintomas s where s.slug = any(p_sintomas) and s.risco) then 'sintoma de risco informado'
           when exists (select 1 from public.sintomas s where s.slug = any(p_sintomas) and s.classe_sugerida is not null) then 'classe do sintoma'
           when p_servico_slug = 'revisao-geral' then 'serviço preventivo'
           else 'padrão'
         end
$$;

-- só especialista ou administrador confirma prioridade, venha de onde vier a gravação
create function app.proteger_triagem() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.prioridade_confirmada is not null
     and auth.uid() is not null
     and coalesce(app.papel_atual()::text, '') not in ('especialista', 'admin') then
    raise exception 'Somente o especialista confirma a prioridade.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger triagens_protecao before insert or update on public.triagens for each row execute function app.proteger_triagem();

-- ---------------------------------------------------------------- agenda
alter table public.recursos
  add column tipo text not null default 'box' check (tipo in ('box', 'profissional')),
  add column perfil_id uuid references public.perfis (id);

alter table public.agendamentos
  add column reagendado_de uuid references public.agendamentos (id),
  add column presenca_confirmada_em timestamptz,
  add column lembrete_enviado_em timestamptz;
alter table public.agendamento_alteracoes drop constraint agendamento_alteracoes_acao_check;
alter table public.agendamento_alteracoes add constraint agendamento_alteracoes_acao_check
  check (acao in ('confirmado', 'cancelado', 'falta', 'concluido', 'reagendado', 'presenca_confirmada'));

create table public.lista_espera (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes (id) on delete cascade,
  desde date not null,
  ate date not null,
  periodos text[] not null default '{manha,tarde}' check (periodos <@ array['manha', 'tarde']::text[] and cardinality(periodos) > 0),
  estado text not null default 'aguardando' check (estado in ('aguardando', 'avisado', 'atendido', 'expirado', 'cancelado')),
  avisado_em timestamptz,
  criado_em timestamptz not null default now(),
  check (ate >= desde)
);
create unique index lista_espera_uma_ativa on public.lista_espera (solicitacao_id) where estado in ('aguardando', 'avisado');

-- ---------------------------------------------------------------- oficina: OS, orçamento, aprovação, pagamento
create sequence public.os_seq start 1;

create table public.ordens_servico (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  solicitacao_id uuid not null unique references public.solicitacoes (id),
  agendamento_id uuid references public.agendamentos (id),
  veiculo_id uuid not null references public.veiculos (id),
  estado public.estado_os not null default 'aberta',
  entrada_em timestamptz not null default now(),
  km_entrada integer not null check (km_entrada between 0 and 500000),
  reclamacao text not null check (length(reclamacao) between 3 and 2000),
  diagnostico text check (length(diagnostico) <= 4000),
  responsavel_tecnico_id uuid references public.perfis (id),
  previsao_conclusao timestamptz,
  concluida_em timestamptz,
  entregue_em timestamptz,
  km_saida integer check (km_saida between 0 and 500000),
  observacoes text check (length(observacoes) <= 2000),
  aberta_por uuid references public.perfis (id),
  atualizado_em timestamptz not null default now(),
  check (km_saida is null or km_saida >= km_entrada),
  check (estado <> 'entregue' or entregue_em is not null),
  check (estado not in ('pronta', 'entregue') or concluida_em is not null)
);
create index ordens_servico_estado_idx on public.ordens_servico (estado);

create function app.gerar_numero_os() returns trigger
language plpgsql as $$
begin
  new.numero := 'OS-' || to_char(now() at time zone app.tz(), 'YYYY') || '-' || lpad(nextval('public.os_seq')::text, 5, '0');
  return new;
end $$;
create trigger ordens_servico_numero before insert on public.ordens_servico for each row execute function app.gerar_numero_os();
create trigger ordens_servico_atualizado before update on public.ordens_servico for each row execute function app.tocar_atualizado_em();

-- registro de cada decisão do cliente sobre o orçamento (inicial ou adicional)
create table public.aprovacoes (
  id uuid primary key default gen_random_uuid(),
  os_id uuid not null references public.ordens_servico (id) on delete cascade,
  canal text not null check (canal in ('presencial', 'whatsapp', 'telefone', 'site')),
  descricao text not null check (length(descricao) between 3 and 1000), -- o que foi dito ou mostrado ao cliente
  registrado_por uuid references public.perfis (id),
  decidido_em timestamptz not null default now()
);

-- valores em centavos, para não haver erro de arredondamento
create table public.os_itens (
  id uuid primary key default gen_random_uuid(),
  os_id uuid not null references public.ordens_servico (id) on delete cascade,
  tipo text not null check (tipo in ('servico', 'peca')),
  descricao text not null check (length(descricao) between 2 and 300),
  servico_id uuid references public.servicos (id),
  quantidade numeric(8, 2) not null default 1 check (quantidade > 0),
  valor_unitario_centavos integer not null check (valor_unitario_centavos >= 0),
  adicional boolean not null default false, -- surgiu depois do orçamento inicial
  estado public.estado_item_os not null default 'proposto',
  aprovacao_id uuid references public.aprovacoes (id),
  executado_por uuid references public.perfis (id),
  executado_em timestamptz,
  criado_em timestamptz not null default now(),
  -- nenhum item é aprovado, recusado ou executado sem a decisão do cliente registrada
  constraint os_item_decisao_registrada check (estado = 'proposto' or aprovacao_id is not null),
  constraint os_item_execucao_registrada check (estado <> 'executado' or (executado_em is not null and executado_por is not null))
);
create index os_itens_os_idx on public.os_itens (os_id);

-- executar exige ter sido aprovado antes; valor aprovado não muda
create function app.proteger_item_os() returns trigger
language plpgsql as $$
begin
  if new.estado = 'executado' and old.estado <> 'aprovado' then
    raise exception 'Só um item aprovado pelo cliente pode ser executado.' using errcode = 'P0001';
  end if;
  if old.estado in ('aprovado', 'executado')
     and (new.valor_unitario_centavos, new.quantidade, new.descricao) is distinct from (old.valor_unitario_centavos, old.quantidade, old.descricao) then
    raise exception 'Item já aprovado não pode mudar de valor ou descrição. Crie um item adicional.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger os_itens_protecao before update on public.os_itens for each row execute function app.proteger_item_os();

create function app.item_novo_proposto() returns trigger
language plpgsql as $$
begin
  if new.estado = 'executado' then
    raise exception 'Só um item aprovado pelo cliente pode ser executado.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger os_itens_novo before insert on public.os_itens for each row execute function app.item_novo_proposto();

create table public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  os_id uuid not null references public.ordens_servico (id),
  valor_centavos integer not null check (valor_centavos > 0),
  forma text not null check (forma in ('pix', 'dinheiro', 'debito', 'credito', 'outro')),
  recebido_em timestamptz not null default now(),
  registrado_por uuid references public.perfis (id),
  estornado_em timestamptz,
  observacao text check (length(observacao) <= 300)
);
create index pagamentos_os_idx on public.pagamentos (os_id);

-- situação financeira calculada, nunca digitada: concluir a OS não a torna paga
create view public.os_financeiro with (security_invoker = true) as
select o.id as os_id,
       coalesce(i.aprovado, 0)::bigint as total_aprovado_centavos,
       coalesce(i.executado, 0)::bigint as total_executado_centavos,
       coalesce(p.pago, 0)::bigint as total_pago_centavos,
       case
         when coalesce(i.executado, 0) = 0 then 'sem_valor'
         when coalesce(p.pago, 0) = 0 then 'pendente'
         when p.pago < i.executado then 'parcial'
         else 'pago'
       end as situacao
from public.ordens_servico o
left join lateral (
  select sum(round(it.quantidade * it.valor_unitario_centavos)) filter (where it.estado in ('aprovado', 'executado')) as aprovado,
         sum(round(it.quantidade * it.valor_unitario_centavos)) filter (where it.estado = 'executado') as executado
  from public.os_itens it where it.os_id = o.id
) i on true
left join lateral (
  select sum(pg.valor_centavos) as pago from public.pagamentos pg where pg.os_id = o.id and pg.estornado_em is null
) p on true;

-- ---------------------------------------------------------------- histórico e recorrência
create table public.recomendacoes (
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references public.veiculos (id) on delete cascade,
  os_id uuid references public.ordens_servico (id) on delete set null,
  descricao text not null check (length(descricao) between 3 and 500),
  data_prevista date,
  km_previsto integer check (km_previsto between 0 and 500000),
  base_tecnica text not null check (base_tecnica in ('manual_fabricante', 'avaliacao_tecnica', 'desgaste_observado')),
  estado text not null default 'pendente' check (estado in ('pendente', 'lembrada', 'atendida', 'descartada')),
  atendida_por uuid references public.solicitacoes (id),
  registrado_por uuid references public.perfis (id),
  criado_em timestamptz not null default now(),
  constraint recomendacao_tem_prazo check (data_prevista is not null or km_previsto is not null)
);
create index recomendacoes_pendentes_idx on public.recomendacoes (data_prevista) where estado in ('pendente', 'lembrada');

-- linha do tempo da moto: uma lista só, montada das tabelas de origem
create view public.linha_do_tempo with (security_invoker = true) as
select s.veiculo_id, s.criado_em as quando, 'solicitacao' as tipo, s.protocolo || ': ' || left(s.descricao, 120) as resumo, s.quilometragem as km, s.id as referencia
  from public.solicitacoes s
union all
select s.veiculo_id, a.inicio, 'agendamento', 'Agendamento ' || a.estado::text, null, a.id
  from public.agendamentos a join public.solicitacoes s on s.id = a.solicitacao_id
union all
select o.veiculo_id, o.entrada_em, 'entrada', o.numero || ': entrada na oficina', o.km_entrada, o.id
  from public.ordens_servico o
union all
select o.veiculo_id, coalesce(o.atualizado_em, o.entrada_em), 'diagnostico', left(o.diagnostico, 200), null, o.id
  from public.ordens_servico o where o.diagnostico is not null
union all
select o.veiculo_id, it.executado_em, case it.tipo when 'peca' then 'peca_substituida' else 'servico_executado' end, it.descricao, null, it.id
  from public.os_itens it join public.ordens_servico o on o.id = it.os_id where it.estado = 'executado'
union all
select o.veiculo_id, o.entregue_em, 'entrega', o.numero || ': entregue', o.km_saida, o.id
  from public.ordens_servico o where o.entregue_em is not null
union all
select r.veiculo_id, r.criado_em, 'recomendacao', r.descricao, r.km_previsto, r.id
  from public.recomendacoes r
union all
select h.veiculo_id, h.realizado_em::timestamptz, 'historico_anterior', h.servico_realizado, h.quilometragem, h.id
  from public.historico_servicos h;

-- ---------------------------------------------------------------- comunicação (fila de saída)
create table public.modelos_mensagem (
  slug text primary key check (slug ~ '^[a-z0-9_]+$'),
  motivo text not null check (motivo in ('recebimento', 'agendamento', 'lembrete_atendimento', 'mudanca_status',
                                          'conclusao', 'lembrete_preventivo', 'divulgacao')),
  canal text not null check (canal in ('whatsapp', 'email')),
  texto text not null check (length(texto) between 10 and 1000),
  aprovado_meta boolean not null default false, -- WhatsApp só envia modelos aprovados pela Meta
  ativo boolean not null default true
);

-- modo 'teste' nunca sai do sistema: aparece no painel com selo de teste
create table public.mensagens (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  modelo_slug text not null references public.modelos_mensagem (slug),
  variaveis jsonb not null default '{}',
  solicitacao_id uuid references public.solicitacoes (id) on delete set null,
  recomendacao_id uuid references public.recomendacoes (id) on delete set null,
  modo text not null check (modo in ('teste', 'real')),
  estado text not null default 'pendente' check (estado in ('pendente', 'enviada', 'entregue', 'lida', 'falhou', 'cancelada')),
  agendada_para timestamptz not null default now(),
  tentativas smallint not null default 0 check (tentativas between 0 and 10),
  id_externo text,
  erro text,
  criado_em timestamptz not null default now(),
  enviada_em timestamptz,
  constraint mensagem_teste_nao_sai check (modo = 'real' or id_externo is null),
  constraint mensagem_enviada_tem_prova check (estado not in ('entregue', 'lida') or (modo = 'real' and id_externo is not null))
);
create index mensagens_fila_idx on public.mensagens (agendada_para) where estado = 'pendente';

-- lembrete e divulgação só para quem aceitou; vale o aceite mais recente
create function app.exigir_consentimento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_motivo text; v_tipo text; v_ok boolean;
begin
  select m.motivo into v_motivo from public.modelos_mensagem m where m.slug = new.modelo_slug;
  v_tipo := case v_motivo when 'lembrete_preventivo' then 'lembretes' when 'divulgacao' then 'marketing' end;
  if v_tipo is null then return new; end if;
  select c.aceito into v_ok from public.consentimentos c
   where c.cliente_id = new.cliente_id and c.tipo = v_tipo order by c.registrado_em desc, c.id desc limit 1;
  if not coalesce(v_ok, false) then
    raise exception 'Cliente sem consentimento para %.', v_tipo using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger mensagens_consentimento before insert on public.mensagens for each row execute function app.exigir_consentimento();

-- ---------------------------------------------------------------- auditoria das novas tabelas
create trigger auditoria_triagens after insert or update or delete on public.triagens for each row execute function app.auditar();
create trigger auditoria_lista_espera after insert or update or delete on public.lista_espera for each row execute function app.auditar();
create trigger auditoria_ordens_servico after insert or update or delete on public.ordens_servico for each row execute function app.auditar();
create trigger auditoria_os_itens after insert or update or delete on public.os_itens for each row execute function app.auditar();
create trigger auditoria_aprovacoes after insert or update or delete on public.aprovacoes for each row execute function app.auditar();
create trigger auditoria_pagamentos after insert or update or delete on public.pagamentos for each row execute function app.auditar();
create trigger auditoria_recomendacoes after insert or update or delete on public.recomendacoes for each row execute function app.auditar();
create trigger auditoria_acessos_protocolo after insert or update or delete on public.acessos_protocolo for each row execute function app.auditar();

-- ---------------------------------------------------------------- RLS
alter table public.acessos_protocolo enable row level security;
alter table public.anexos enable row level security;
alter table public.triagens enable row level security;
alter table public.lista_espera enable row level security;
alter table public.ordens_servico enable row level security;
alter table public.aprovacoes enable row level security;
alter table public.os_itens enable row level security;
alter table public.pagamentos enable row level security;
alter table public.recomendacoes enable row level security;
alter table public.modelos_mensagem enable row level security;
alter table public.mensagens enable row level security;

create function app.solicitacao_do_cliente(p_sol uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.solicitacoes s where s.id = p_sol and s.cliente_id = app.cliente_atual())
$$;
create function app.os_do_cliente(p_os uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ordens_servico o join public.veiculos v on v.id = o.veiculo_id
                 where o.id = p_os and v.cliente_id = app.cliente_atual())
$$;

-- o cliente vê o que é dele; triagem, aprovação interna, mensagens e tokens só a equipe
create policy equipe on public.acessos_protocolo for select using (app.eh_equipe());
create policy proprio_ou_equipe on public.anexos for select using (app.eh_equipe() or app.solicitacao_do_cliente(solicitacao_id));
create policy equipe on public.triagens for select using (app.eh_equipe());
create policy proprio_ou_equipe on public.lista_espera for select using (app.eh_equipe() or app.solicitacao_do_cliente(solicitacao_id));
create policy proprio_ou_equipe on public.ordens_servico for select using (app.eh_equipe() or app.os_do_cliente(id));
create policy proprio_ou_equipe on public.aprovacoes for select using (app.eh_equipe() or app.os_do_cliente(os_id));
create policy proprio_ou_equipe on public.os_itens for select using (app.eh_equipe() or app.os_do_cliente(os_id));
create policy proprio_ou_equipe on public.pagamentos for select using (app.eh_equipe() or app.os_do_cliente(os_id));
create policy proprio_ou_equipe on public.recomendacoes for select
  using (app.eh_equipe() or veiculo_id in (select v.id from public.veiculos v where v.cliente_id = app.cliente_atual()));
create policy equipe on public.modelos_mensagem for select using (app.eh_equipe());
create policy admin_escreve on public.modelos_mensagem for all using (app.papel_atual() = 'admin') with check (app.papel_atual() = 'admin');
create policy equipe on public.mensagens for select using (app.eh_equipe());

-- leitura pelo RLS; escrita só pelas funções das próximas etapas (exceto catálogo de mensagens, do admin)
revoke all on public.acessos_protocolo, public.anexos, public.triagens, public.lista_espera, public.ordens_servico,
  public.aprovacoes, public.os_itens, public.pagamentos, public.recomendacoes, public.modelos_mensagem, public.mensagens
  from anon, authenticated;
grant select on public.anexos, public.triagens, public.lista_espera, public.ordens_servico, public.aprovacoes,
  public.os_itens, public.pagamentos, public.recomendacoes, public.modelos_mensagem, public.mensagens,
  public.acessos_protocolo, public.os_financeiro, public.linha_do_tempo to authenticated;
grant insert, update, delete on public.modelos_mensagem to authenticated;
revoke all on sequence public.os_seq from anon, authenticated;
revoke execute on function app.sugerir_prioridade, app.solicitacao_do_cliente, app.os_do_cliente from public;
grant execute on function app.sugerir_prioridade, app.solicitacao_do_cliente, app.os_do_cliente to authenticated;

-- ===== Etapa 2: dados ilustrativos

-- Etapa 2 (premissas ilustrativas, a validar com a oficina após a contratação)
-- Revisão e serviços de motor podem ser marcados direto; os demais passam pela avaliação do especialista.
update public.servicos set exige_avaliacao = false where slug in ('revisao-geral', 'motor');
update public.sintomas set classe_sugerida = 'prioritaria' where slug in ('nao-liga', 'falhando');
update public.sintomas set classe_sugerida = 'programavel' where slug in ('luz-painel', 'ruido', 'consumo-alto');

-- Textos ilustrativos. No WhatsApp, cada modelo precisa de aprovação da Meta antes do primeiro envio real.
insert into public.modelos_mensagem (slug, motivo, canal, texto) values
  ('recebimento', 'recebimento', 'whatsapp', 'Olá, {{nome}}! Recebemos sua solicitação {{protocolo}}. O especialista vai avaliar e retornamos por aqui.'),
  ('agendamento', 'agendamento', 'whatsapp', 'Seu horário na Master Scooter está confirmado para {{data}} às {{hora}}. Protocolo {{protocolo}}.'),
  ('lembrete_vespera', 'lembrete_atendimento', 'whatsapp', 'Lembrete: amanhã, {{data}} às {{hora}}, sua moto é esperada na Master Scooter. Responda 1 para confirmar ou 2 para remarcar.'),
  ('mudanca_status', 'mudanca_status', 'whatsapp', 'Atualização do protocolo {{protocolo}}: {{status}}.'),
  ('orcamento', 'mudanca_status', 'whatsapp', 'O orçamento da sua moto ({{protocolo}}) está pronto: {{valor}}. Veja os itens e aprove pelo link: {{link}}'),
  ('conclusao', 'conclusao', 'whatsapp', 'Sua moto está pronta para retirada! Protocolo {{protocolo}}. Atendemos até {{fechamento}}.'),
  ('lembrete_preventivo', 'lembrete_preventivo', 'whatsapp', 'Olá, {{nome}}! Pela última visita, está chegando a hora de: {{recomendacao}}. Quer agendar?');

-- ===== Etapa 4: perfis de acesso
-- Master Scooter Motos · Etapa 4: autenticação e perfis de acesso
-- Equipe gerida pelo administrador por funções do banco (não mais por SQL manual),
-- acesso desativado vale também para clientes, e link de acompanhamento para quem não tem login.

-- ---------------------------------------------------------------- acesso desativado
-- cliente com perfil desativado deixa de ver os próprios dados e de abrir pedidos
create or replace function app.cliente_atual() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clientes c join public.perfis p on p.id = c.perfil_id
  where c.perfil_id = auth.uid() and p.ativo
$$;

-- a oficina nunca fica sem administrador ativo
create function app.proteger_ultimo_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.papel = 'admin' and old.ativo
     and (tg_op = 'DELETE' or new.papel <> 'admin' or not new.ativo)
     and not exists (select 1 from public.perfis p where p.papel = 'admin' and p.ativo and p.id <> old.id) then
    raise exception 'A oficina precisa de pelo menos um administrador ativo.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger perfis_ultimo_admin before update or delete on public.perfis for each row execute function app.proteger_ultimo_admin();
create trigger auditoria_perfis after insert or update or delete on public.perfis for each row execute function app.auditar();

-- perfis só mudam pelas funções abaixo, que registram quem fez e aplicam as regras
drop policy admin_gerencia on public.perfis;
revoke update on public.perfis from authenticated;

-- ---------------------------------------------------------------- gestão da equipe (somente administrador)
create function app.exigir_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.papel_atual() is distinct from 'admin' then perform app.erro('Somente o administrador gerencia a equipe.'); end if;
end $$;

create function public.listar_equipe()
returns table (id uuid, nome text, email text, papel public.papel, ativo boolean, criado_em timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.exigir_admin();
  return query
    select p.id, p.nome, u.email::text, p.papel, p.ativo, p.criado_em
    from public.perfis p join auth.users u on u.id = p.id
    where p.papel <> 'cliente'
    order by p.ativo desc, p.nome;
end $$;

-- a pessoa entra uma vez pelo site com o próprio e-mail; depois o administrador define o perfil dela.
-- papel 'cliente' tira a pessoa da equipe sem apagar o histórico.
create function public.definir_perfil_equipe(p_email text, p_papel public.papel, p_nome text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_nome text := btrim(coalesce(p_nome, ''));
begin
  perform app.exigir_admin();
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_id is null then
    perform app.erro('Esta pessoa ainda não entrou no sistema. Peça que ela acesse “Entrar” uma vez com este e-mail.');
  end if;
  if v_id = auth.uid() then perform app.erro('Você não pode mudar o seu próprio perfil.'); end if;
  if length(v_nome) not between 2 and 120 then perform app.erro('Informe o nome da pessoa.'); end if;
  insert into public.perfis (id, papel, nome) values (v_id, p_papel, v_nome)
  on conflict (id) do update set papel = excluded.papel, nome = excluded.nome, ativo = true;
  return v_id;
end $$;

create function public.definir_acesso(p_perfil uuid, p_ativo boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.exigir_admin();
  if p_perfil = auth.uid() then perform app.erro('Você não pode desativar o seu próprio acesso.'); end if;
  update public.perfis set ativo = p_ativo where id = p_perfil;
  if not found then perform app.erro('Pessoa não encontrada.'); end if;
end $$;

-- ---------------------------------------------------------------- link de acompanhamento sem login
-- o token tem 244 bits aleatórios; o banco guarda só o SHA-256 dele
create function public.gerar_acesso_protocolo(p_solicitacao uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if not app.eh_equipe() then perform app.erro('Acesso restrito à equipe da oficina.'); end if;
  if not exists (select 1 from public.solicitacoes where id = p_solicitacao) then perform app.erro('Solicitação não encontrada.'); end if;
  update public.acessos_protocolo set revogado_em = now() where solicitacao_id = p_solicitacao and revogado_em is null;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.acessos_protocolo (solicitacao_id, token_hash, expira_em, criado_por)
  values (p_solicitacao, sha256(convert_to(v_token, 'UTF8')), now() + interval '30 days', auth.uid());
  return v_token;
end $$;

create function public.revogar_acesso_protocolo(p_solicitacao uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.eh_equipe() then perform app.erro('Acesso restrito à equipe da oficina.'); end if;
  update public.acessos_protocolo set revogado_em = now() where solicitacao_id = p_solicitacao and revogado_em is null;
end $$;

-- mostra só o andamento: sem nome, telefone, placa ou observações internas, caso o link seja repassado
create function public.consultar_protocolo(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_sol public.solicitacoes;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then perform app.erro('Link inválido ou expirado. Peça um novo à oficina.'); end if;
  select s.* into v_sol from public.acessos_protocolo a join public.solicitacoes s on s.id = a.solicitacao_id
  where a.token_hash = sha256(convert_to(p_token, 'UTF8')) and a.revogado_em is null and a.expira_em > now();
  if not found then perform app.erro('Link inválido ou expirado. Peça um novo à oficina.'); end if;
  return jsonb_build_object(
    'protocolo', v_sol.protocolo,
    'status', v_sol.status,
    'criado_em', v_sol.criado_em,
    'moto', (select v.marca || ' ' || v.modelo from public.veiculos v where v.id = v_sol.veiculo_id),
    'servico', (select sv.nome from public.servicos sv where sv.id = v_sol.servico_id),
    'agendamento', (select a.inicio from public.agendamentos a where a.solicitacao_id = v_sol.id and a.estado = 'confirmado'),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('quando', e.criado_em, 'descricao', coalesce(e.descricao, ''), 'status', e.status_novo) order by e.criado_em)
                         from public.solicitacao_eventos e where e.solicitacao_id = v_sol.id and e.visivel_cliente), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- permissões
revoke execute on function app.exigir_admin, app.proteger_ultimo_admin from public;
grant execute on function app.exigir_admin to authenticated;
revoke execute on function public.listar_equipe, public.definir_perfil_equipe, public.definir_acesso,
  public.gerar_acesso_protocolo, public.revogar_acesso_protocolo, public.consultar_protocolo from public;
grant execute on function public.listar_equipe, public.definir_perfil_equipe, public.definir_acesso,
  public.gerar_acesso_protocolo, public.revogar_acesso_protocolo to authenticated;
grant execute on function public.consultar_protocolo to anon, authenticated;

commit;
