-- Master Scooter Motos · estrutura inicial do banco (entrega E2)
-- Fonte única de verdade para site, painel e chatbot.
-- Regras de agenda, prioridade e acesso ficam aqui, e não só na interface.

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

create schema if not exists app;

-- ---------------------------------------------------------------- tipos
create type public.papel as enum ('admin', 'atendente', 'especialista', 'cliente');
create type public.status_solicitacao as enum (
  'recebida', 'aguardando_avaliacao', 'aguardando_info_cliente', 'aguardando_aprovacao_especialista',
  'aguardando_agendamento', 'agendado', 'veiculo_recebido', 'em_manutencao',
  'aguardando_aprovacao_orcamento', 'concluido', 'cancelado'
);
create type public.prioridade as enum ('baixa', 'media', 'alta', 'urgente');
create type public.estado_agendamento as enum ('confirmado', 'cancelado', 'falta', 'concluido');

-- ---------------------------------------------------------------- configuração da oficina
create table public.configuracao (
  id boolean primary key default true check (id),
  fuso_horario text not null default 'America/Sao_Paulo',
  intervalo_slots_min integer not null default 60 check (intervalo_slots_min in (15, 30, 60)),
  antecedencia_min_horas integer not null default 2 check (antecedencia_min_horas >= 0),
  janela_agendamento_dias integer not null default 30 check (janela_agendamento_dias between 1 and 120),
  capacidade_diaria_padrao integer not null default 6 check (capacidade_diaria_padrao > 0)
);
insert into public.configuracao default values;

create table public.horarios_funcionamento (
  dia_semana smallint not null check (dia_semana between 0 and 6), -- 0 = domingo
  abre time not null,
  fecha time not null,
  primary key (dia_semana, abre),
  check (fecha > abre)
);

create table public.capacidade_diaria (
  dia_semana smallint primary key check (dia_semana between 0 and 6),
  limite integer not null check (limite >= 0)
);

create table public.recursos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true
);

create table public.servicos (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  nome text not null,
  itens text[] not null default '{}',
  duracao_minutos integer not null check (duracao_minutos between 15 and 480),
  ativo boolean not null default true,
  ordem integer not null default 0
);

-- lista de sintomas definida pela oficina; risco = mostra orientação de segurança
create table public.sintomas (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  texto text not null,
  risco boolean not null default false,
  ativo boolean not null default true
);

create table public.bloqueios (
  id uuid primary key default gen_random_uuid(),
  recurso_id uuid references public.recursos (id) on delete cascade, -- nulo = oficina inteira
  periodo tstzrange not null check (not isempty(periodo)),
  motivo text not null check (length(motivo) between 2 and 200),
  criado_por uuid,
  criado_em timestamptz not null default now()
);
create index bloqueios_periodo_idx on public.bloqueios using gist (periodo);

-- ---------------------------------------------------------------- pessoas
create table public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  papel public.papel not null default 'cliente',
  nome text not null check (length(nome) between 2 and 120),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.origens (
  id uuid primary key default gen_random_uuid(),
  canal text not null check (canal in ('instagram', 'anuncio', 'google', 'indicacao', 'whatsapp', 'site', 'outro')),
  utm_source text check (length(utm_source) <= 100),
  utm_medium text check (length(utm_medium) <= 100),
  utm_campaign text check (length(utm_campaign) <= 100),
  utm_content text check (length(utm_content) <= 100),
  landing_page text check (length(landing_page) <= 300),
  criado_em timestamptz not null default now()
);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid unique references public.perfis (id) on delete set null,
  nome_completo text not null check (length(nome_completo) between 3 and 120),
  telefone text not null unique check (telefone ~ '^[0-9]{10,11}$'),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  preferencia_contato text not null default 'whatsapp' check (preferencia_contato in ('whatsapp', 'email', 'telefone')),
  origem_id uuid references public.origens (id),
  anonimizado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.consentimentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  tipo text not null check (tipo in ('termos', 'privacidade', 'lembretes', 'marketing')),
  versao_texto text not null,
  aceito boolean not null,
  canal text not null check (canal in ('site', 'whatsapp', 'balcao')),
  registrado_em timestamptz not null default now()
);

create table public.veiculos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  marca text not null check (length(marca) between 2 and 40),
  modelo text not null check (length(modelo) between 1 and 60),
  ano smallint not null check (ano between 1980 and 2100),
  quilometragem integer not null check (quilometragem between 0 and 500000),
  placa text check (placa is null or placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  ultima_manutencao_em date,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------- atendimento
create sequence public.protocolo_seq start 1;

create table public.solicitacoes (
  id uuid primary key default gen_random_uuid(),
  protocolo text not null unique,
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  veiculo_id uuid not null references public.veiculos (id) on delete cascade,
  servico_id uuid references public.servicos (id),
  descricao text not null check (length(descricao) between 10 and 2000),
  sintomas text[] not null default '{}',
  inicio_problema text check (length(inicio_problema) <= 100),
  quilometragem integer not null check (quilometragem between 0 and 500000),
  disponibilidade text check (length(disponibilidade) <= 200),
  sintoma_risco boolean not null default false,
  status public.status_solicitacao not null default 'recebida',
  prioridade public.prioridade,
  responsavel_id uuid references public.perfis (id),
  tempo_estimado_min integer check (tempo_estimado_min between 15 and 4800),
  preferencia_inicio timestamptz,
  origem_id uuid references public.origens (id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index solicitacoes_cliente_idx on public.solicitacoes (cliente_id);
create index solicitacoes_status_idx on public.solicitacoes (status);

-- linha do tempo; visivel_cliente = aparece para o dono da solicitação
create table public.solicitacao_eventos (
  id bigint generated always as identity primary key,
  solicitacao_id uuid not null references public.solicitacoes (id) on delete cascade,
  status_anterior public.status_solicitacao,
  status_novo public.status_solicitacao not null,
  descricao text,
  autor_id uuid,
  canal text not null default 'site',
  visivel_cliente boolean not null default true,
  criado_em timestamptz not null default now()
);
create index solicitacao_eventos_sol_idx on public.solicitacao_eventos (solicitacao_id);

-- observações que o cliente nunca vê
create table public.notas_internas (
  id bigint generated always as identity primary key,
  solicitacao_id uuid not null references public.solicitacoes (id) on delete cascade,
  autor_id uuid not null,
  texto text not null check (length(texto) between 1 and 2000),
  criado_em timestamptz not null default now()
);

create table public.historico_servicos (
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references public.veiculos (id) on delete cascade,
  solicitacao_id uuid references public.solicitacoes (id) on delete set null,
  realizado_em date not null,
  quilometragem integer check (quilometragem between 0 and 500000),
  servico_realizado text not null,
  pecas_substituidas text,
  proxima_manutencao_em date,
  proxima_manutencao_km integer
);

create table public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references public.solicitacoes (id) on delete cascade,
  recurso_id uuid not null references public.recursos (id),
  periodo tstzrange not null check (not isempty(periodo)),
  estado public.estado_agendamento not null default 'confirmado',
  confirmado_por uuid,
  criado_em timestamptz not null default now(),
  -- última barreira contra horário duplicado, mesmo com duas confirmações simultâneas
  constraint agendamentos_sem_sobreposicao
    exclude using gist (recurso_id with =, periodo with &&) where (estado = 'confirmado')
);
create unique index agendamentos_um_confirmado_por_solicitacao
  on public.agendamentos (solicitacao_id) where estado = 'confirmado';

create table public.agendamento_alteracoes (
  id bigint generated always as identity primary key,
  agendamento_id uuid not null references public.agendamentos (id) on delete cascade,
  acao text not null check (acao in ('confirmado', 'cancelado', 'falta', 'concluido')),
  motivo text,
  autor_id uuid,
  criado_em timestamptz not null default now()
);

create table public.auditoria (
  id bigint generated always as identity primary key,
  tabela text not null,
  registro_id text not null,
  acao text not null,
  autor_id uuid,
  antes jsonb,
  depois jsonb,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------- funções de apoio
create function app.papel_atual() returns public.papel
language sql stable security definer set search_path = '' as $$
  select p.papel from public.perfis p where p.id = auth.uid() and p.ativo
$$;

create function app.eh_equipe() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.papel_atual() in ('admin', 'atendente', 'especialista'), false)
$$;

create function app.cliente_atual() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.clientes c where c.perfil_id = auth.uid()
$$;

create function app.tz() returns text
language sql stable set search_path = '' as $$ select fuso_horario from public.configuracao $$;

create function app.erro(mensagem text) returns void
language plpgsql as $$ begin raise exception using message = mensagem, errcode = 'P0001'; end $$;

create function app.registrar_evento(p_sol uuid, p_de public.status_solicitacao, p_para public.status_solicitacao,
  p_descricao text, p_visivel boolean default true, p_canal text default 'site') returns void
language sql security definer set search_path = '' as $$
  insert into public.solicitacao_eventos (solicitacao_id, status_anterior, status_novo, descricao, autor_id, canal, visivel_cliente)
  values (p_sol, p_de, p_para, p_descricao, auth.uid(), p_canal, p_visivel)
$$;

create function app.tocar_atualizado_em() returns trigger
language plpgsql as $$ begin new.atualizado_em := now(); return new; end $$;
create trigger clientes_atualizado before update on public.clientes for each row execute function app.tocar_atualizado_em();
create trigger solicitacoes_atualizado before update on public.solicitacoes for each row execute function app.tocar_atualizado_em();

create function app.auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.auditoria (tabela, registro_id, acao, autor_id, antes, depois)
  values (tg_table_name, coalesce(new.id, old.id)::text, tg_op, auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger auditoria_clientes after insert or update or delete on public.clientes for each row execute function app.auditar();
create trigger auditoria_solicitacoes after insert or update or delete on public.solicitacoes for each row execute function app.auditar();
create trigger auditoria_agendamentos after insert or update or delete on public.agendamentos for each row execute function app.auditar();
create trigger auditoria_bloqueios after insert or update or delete on public.bloqueios for each row execute function app.auditar();

-- protocolo gerado sempre no banco
create function app.gerar_protocolo() returns trigger
language plpgsql as $$
begin
  new.protocolo := 'MS-' || to_char(now() at time zone app.tz(), 'YYYY') || '-' || lpad(nextval('public.protocolo_seq')::text, 6, '0');
  return new;
end $$;
create trigger solicitacoes_protocolo before insert on public.solicitacoes for each row execute function app.gerar_protocolo();

-- prioridade só pode ser gravada por especialista ou administrador, venha de onde vier a alteração
create function app.proteger_prioridade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.prioridade is distinct from old.prioridade
     and auth.uid() is not null
     and coalesce(app.papel_atual()::text, '') not in ('especialista', 'admin') then
    perform app.erro('Somente o especialista técnico ou o administrador pode definir a prioridade.');
  end if;
  return new;
end $$;
create trigger solicitacoes_prioridade before update on public.solicitacoes for each row execute function app.proteger_prioridade();

-- ---------------------------------------------------------------- regras de agenda
-- Diz por que um horário não pode ser usado; nulo = pode. Usada pela vitrine de horários e pela confirmação.
create function app.motivo_indisponivel(p_inicio timestamptz, p_duracao_min integer, p_ignorar_solicitacao uuid default null)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := app.tz();
  v_local timestamp := p_inicio at time zone v_tz;
  v_fim timestamptz := p_inicio + make_interval(mins => p_duracao_min);
  v_dia date := v_local::date;
  v_dow smallint := extract(dow from v_local)::smallint;
  v_limite integer;
  v_ocupados integer;
begin
  if p_duracao_min is null or p_duracao_min <= 0 then return 'Duração inválida.'; end if;
  if not exists (
    select 1 from public.horarios_funcionamento h
    where h.dia_semana = v_dow and v_local::time >= h.abre
      and (v_local + make_interval(mins => p_duracao_min))::time <= h.fecha
      and (v_local + make_interval(mins => p_duracao_min))::date = v_dia
  ) then
    return 'Fora do horário de funcionamento.';
  end if;
  if exists (select 1 from public.bloqueios b where b.recurso_id is null and b.periodo && tstzrange(p_inicio, v_fim)) then
    return 'Horário bloqueado pela oficina.';
  end if;
  select coalesce((select c.limite from public.capacidade_diaria c where c.dia_semana = v_dow),
                  (select capacidade_diaria_padrao from public.configuracao)) into v_limite;
  select count(*) into v_ocupados from public.agendamentos a
   where a.estado = 'confirmado' and (lower(a.periodo) at time zone v_tz)::date = v_dia
     and a.solicitacao_id is distinct from p_ignorar_solicitacao;
  if v_ocupados >= v_limite then return 'Capacidade do dia atingida.'; end if;
  if app.recurso_livre(p_inicio, v_fim) is null then return 'Todos os boxes estão ocupados nesse horário.'; end if;
  return null;
end $$;

create function app.recurso_livre(p_inicio timestamptz, p_fim timestamptz) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.id from public.recursos r
  where r.ativo
    and not exists (select 1 from public.agendamentos a where a.recurso_id = r.id and a.estado = 'confirmado'
                    and a.periodo && tstzrange(p_inicio, p_fim))
    and not exists (select 1 from public.bloqueios b where b.recurso_id = r.id and b.periodo && tstzrange(p_inicio, p_fim))
  order by r.nome
  limit 1
$$;

-- ---------------------------------------------------------------- operações (RPC)
-- Cliente se cadastra depois de entrar com o código de acesso.
create function public.registrar_cliente(
  p_nome text, p_telefone text, p_email text, p_preferencia text,
  p_aceite_privacidade boolean, p_aceite_lembretes boolean, p_versao_texto text,
  p_origem_canal text default 'site', p_utm jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g');
  v_cliente uuid;
  v_origem uuid;
begin
  if v_uid is null then perform app.erro('Entre com o código de acesso antes de criar o cadastro.'); end if;
  if not coalesce(p_aceite_privacidade, false) then perform app.erro('É preciso concordar com o aviso de privacidade.'); end if;
  if exists (select 1 from public.clientes where perfil_id = v_uid) then perform app.erro('Esta conta já tem cadastro.'); end if;
  if exists (select 1 from public.clientes where telefone = v_tel) then perform app.erro('Este telefone já tem cadastro.'); end if;

  insert into public.perfis (id, papel, nome) values (v_uid, 'cliente', btrim(p_nome))
  on conflict (id) do nothing;
  insert into public.origens (canal, utm_source, utm_medium, utm_campaign, utm_content, landing_page)
  values (coalesce(p_origem_canal, 'site'), p_utm->>'utm_source', p_utm->>'utm_medium', p_utm->>'utm_campaign', p_utm->>'utm_content', p_utm->>'landing_page')
  returning id into v_origem;
  insert into public.clientes (perfil_id, nome_completo, telefone, email, preferencia_contato, origem_id)
  values (v_uid, btrim(p_nome), v_tel, nullif(btrim(coalesce(p_email, '')), ''), coalesce(p_preferencia, 'whatsapp'), v_origem)
  returning id into v_cliente;
  insert into public.consentimentos (cliente_id, tipo, versao_texto, aceito, canal) values
    (v_cliente, 'privacidade', p_versao_texto, true, 'site'),
    (v_cliente, 'lembretes', p_versao_texto, coalesce(p_aceite_lembretes, false), 'site');
  return v_cliente;
end $$;

create function public.cadastrar_veiculo(p_marca text, p_modelo text, p_ano integer, p_km integer, p_placa text default null, p_ultima date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_cliente uuid := app.cliente_atual(); v_id uuid;
begin
  if v_cliente is null then perform app.erro('Crie seu cadastro antes de registrar a scooter.'); end if;
  if p_ano > extract(year from now())::int + 1 then perform app.erro('Ano da scooter inválido.'); end if;
  insert into public.veiculos (cliente_id, marca, modelo, ano, quilometragem, placa, ultima_manutencao_em)
  values (v_cliente, btrim(p_marca), btrim(p_modelo), p_ano, p_km, nullif(upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g')), ''), p_ultima)
  returning id into v_id;
  return v_id;
end $$;

create function public.criar_solicitacao(
  p_veiculo uuid, p_servico_slug text, p_descricao text, p_sintomas text[],
  p_inicio_problema text, p_km integer, p_disponibilidade text, p_canal text default 'site'
) returns table (id uuid, protocolo text, status public.status_solicitacao, sintoma_risco boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_cliente uuid := app.cliente_atual();
  v_veic public.veiculos;
  v_risco boolean;
  v_sol public.solicitacoes;
begin
  if v_cliente is null then perform app.erro('Crie seu cadastro antes de abrir uma solicitação.'); end if;
  select * into v_veic from public.veiculos v where v.id = p_veiculo and v.cliente_id = v_cliente;
  if not found then perform app.erro('Scooter não encontrada no seu cadastro.'); end if;
  if p_km < v_veic.quilometragem then perform app.erro('A quilometragem não pode ser menor que a já registrada.'); end if;
  if exists (select 1 from unnest(coalesce(p_sintomas, '{}')) s where s not in (select slug from public.sintomas where ativo)) then
    perform app.erro('Sintoma desconhecido.');
  end if;
  select coalesce(bool_or(s.risco), false) into v_risco from public.sintomas s where s.slug = any(coalesce(p_sintomas, '{}'));

  update public.veiculos set quilometragem = p_km where veiculos.id = v_veic.id;
  insert into public.solicitacoes (protocolo, cliente_id, veiculo_id, servico_id, descricao, sintomas, inicio_problema,
                                   quilometragem, disponibilidade, sintoma_risco, origem_id)
  values ('pendente', v_cliente, v_veic.id, (select s.id from public.servicos s where s.slug = p_servico_slug and s.ativo),
          btrim(p_descricao), coalesce(p_sintomas, '{}'), nullif(btrim(coalesce(p_inicio_problema, '')), ''), p_km,
          nullif(btrim(coalesce(p_disponibilidade, '')), ''), v_risco,
          (select c.origem_id from public.clientes c where c.id = v_cliente))
  returning * into v_sol;
  perform app.registrar_evento(v_sol.id, null, 'recebida', 'Solicitação registrada', true, p_canal);
  return query select v_sol.id, v_sol.protocolo, v_sol.status, v_sol.sintoma_risco;
end $$;

-- Horários livres para a vitrine (site e chatbot). Não revela dados de ninguém.
create function public.horarios_disponiveis(p_data date, p_servico_slug text)
returns table (inicio timestamptz) language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := app.tz();
  v_cfg public.configuracao;
  v_dur integer;
  h record;
  v_t timestamp;
begin
  select * into v_cfg from public.configuracao;
  select s.duracao_minutos into v_dur from public.servicos s where s.slug = p_servico_slug and s.ativo;
  if v_dur is null then v_dur := v_cfg.intervalo_slots_min; end if;
  if p_data > (now() at time zone v_tz)::date + v_cfg.janela_agendamento_dias then return; end if;
  for h in select * from public.horarios_funcionamento where dia_semana = extract(dow from p_data) order by abre loop
    v_t := p_data + h.abre;
    while v_t + make_interval(mins => v_dur) <= p_data + h.fecha loop
      if (v_t at time zone v_tz) >= now() + make_interval(hours => v_cfg.antecedencia_min_horas)
         and app.motivo_indisponivel(v_t at time zone v_tz, v_dur) is null then
        inicio := v_t at time zone v_tz; return next;
      end if;
      v_t := v_t + make_interval(mins => v_cfg.intervalo_slots_min);
    end loop;
  end loop;
end $$;

create function public.indicar_preferencia(p_solicitacao uuid, p_inicio timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_sol public.solicitacoes; v_dur integer; v_motivo text;
begin
  select * into v_sol from public.solicitacoes s where s.id = p_solicitacao and s.cliente_id = app.cliente_atual() for update;
  if not found then perform app.erro('Solicitação não encontrada.'); end if;
  if v_sol.status <> 'aguardando_agendamento' then perform app.erro('Aguarde a avaliação do especialista para escolher um horário.'); end if;
  v_dur := coalesce((select duracao_minutos from public.servicos where id = v_sol.servico_id), 60);
  v_motivo := app.motivo_indisponivel(p_inicio, v_dur);
  if v_motivo is not null then perform app.erro(v_motivo || ' Escolha outro horário.'); end if;
  update public.solicitacoes set preferencia_inicio = p_inicio where id = v_sol.id;
  perform app.registrar_evento(v_sol.id, v_sol.status, v_sol.status,
    'Preferência indicada: ' || to_char(p_inicio at time zone app.tz(), 'DD/MM/YYYY HH24:MI'));
end $$;

create function public.atualizar_triagem(
  p_solicitacao uuid, p_status public.status_solicitacao, p_prioridade public.prioridade,
  p_servico_slug text, p_tempo_estimado_min integer, p_nota_interna text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_sol public.solicitacoes; v_papel public.papel := app.papel_atual();
begin
  if not app.eh_equipe() then perform app.erro('Acesso restrito à equipe da oficina.'); end if;
  select * into v_sol from public.solicitacoes where id = p_solicitacao for update;
  if not found then perform app.erro('Solicitação não encontrada.'); end if;
  if p_status = 'agendado' and v_sol.status <> 'agendado' then
    perform app.erro('Para marcar como agendado, confirme um horário na agenda.');
  end if;
  update public.solicitacoes set
    status = p_status,
    prioridade = p_prioridade,
    servico_id = coalesce((select id from public.servicos where slug = p_servico_slug), servico_id),
    tempo_estimado_min = p_tempo_estimado_min,
    responsavel_id = case when p_prioridade is distinct from v_sol.prioridade then auth.uid() else responsavel_id end
  where id = v_sol.id;
  if p_prioridade is distinct from v_sol.prioridade then
    perform app.registrar_evento(v_sol.id, v_sol.status, p_status, 'Prioridade definida: ' || coalesce(p_prioridade::text, 'nenhuma'), false);
  end if;
  if p_status <> v_sol.status then
    perform app.registrar_evento(v_sol.id, v_sol.status, p_status, null, true);
  end if;
  if p_status = 'cancelado' then
    update public.agendamentos set estado = 'cancelado' where solicitacao_id = v_sol.id and estado = 'confirmado';
  end if;
  if nullif(btrim(coalesce(p_nota_interna, '')), '') is not null then
    insert into public.notas_internas (solicitacao_id, autor_id, texto) values (v_sol.id, auth.uid(), btrim(p_nota_interna));
  end if;
end $$;

-- Confirmação: trava o dia, revalida tudo e grava. A restrição de exclusão é a última barreira.
create function public.confirmar_agendamento(p_solicitacao uuid, p_inicio timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_sol public.solicitacoes; v_dur integer; v_motivo text; v_recurso uuid; v_id uuid;
  v_fim timestamptz;
begin
  if not app.eh_equipe() then perform app.erro('Somente a equipe da oficina confirma agendamentos.'); end if;
  perform pg_advisory_xact_lock(hashtext('agenda:' || ((p_inicio at time zone app.tz())::date)::text));
  select * into v_sol from public.solicitacoes where id = p_solicitacao for update;
  if not found then perform app.erro('Solicitação não encontrada.'); end if;
  if v_sol.status in ('cancelado', 'concluido') then perform app.erro('Solicitação encerrada.'); end if;
  if exists (select 1 from public.agendamentos where solicitacao_id = v_sol.id and estado = 'confirmado') then
    perform app.erro('Esta solicitação já tem horário confirmado. Cancele antes de reagendar.');
  end if;
  v_dur := coalesce((select duracao_minutos from public.servicos where id = v_sol.servico_id), 60);
  v_fim := p_inicio + make_interval(mins => v_dur);
  v_motivo := app.motivo_indisponivel(p_inicio, v_dur);
  if v_motivo is not null then perform app.erro('Horário indisponível: ' || v_motivo); end if;
  v_recurso := app.recurso_livre(p_inicio, v_fim);
  insert into public.agendamentos (solicitacao_id, recurso_id, periodo, confirmado_por)
  values (v_sol.id, v_recurso, tstzrange(p_inicio, v_fim), auth.uid()) returning id into v_id;
  insert into public.agendamento_alteracoes (agendamento_id, acao, autor_id) values (v_id, 'confirmado', auth.uid());
  update public.solicitacoes set status = 'agendado', preferencia_inicio = null where id = v_sol.id;
  perform app.registrar_evento(v_sol.id, v_sol.status, 'agendado',
    'Agendado para ' || to_char(p_inicio at time zone app.tz(), 'DD/MM/YYYY "às" HH24:MI'));
  return v_id;
end $$;

create function public.cancelar_agendamento(p_agendamento uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ag public.agendamentos; v_status public.status_solicitacao;
begin
  if not app.eh_equipe() then perform app.erro('Acesso restrito à equipe da oficina.'); end if;
  update public.agendamentos set estado = 'cancelado' where id = p_agendamento and estado = 'confirmado' returning * into v_ag;
  if not found then perform app.erro('Agendamento não encontrado ou já encerrado.'); end if;
  insert into public.agendamento_alteracoes (agendamento_id, acao, motivo, autor_id) values (v_ag.id, 'cancelado', p_motivo, auth.uid());
  select status into v_status from public.solicitacoes where id = v_ag.solicitacao_id;
  update public.solicitacoes set status = 'aguardando_agendamento' where id = v_ag.solicitacao_id;
  perform app.registrar_evento(v_ag.solicitacao_id, v_status, 'aguardando_agendamento', 'Agendamento cancelado pela oficina');
end $$;

-- ---------------------------------------------------------------- segurança de linha (RLS)
alter table public.configuracao enable row level security;
alter table public.horarios_funcionamento enable row level security;
alter table public.capacidade_diaria enable row level security;
alter table public.recursos enable row level security;
alter table public.servicos enable row level security;
alter table public.sintomas enable row level security;
alter table public.bloqueios enable row level security;
alter table public.perfis enable row level security;
alter table public.origens enable row level security;
alter table public.clientes enable row level security;
alter table public.consentimentos enable row level security;
alter table public.veiculos enable row level security;
alter table public.solicitacoes enable row level security;
alter table public.solicitacao_eventos enable row level security;
alter table public.notas_internas enable row level security;
alter table public.historico_servicos enable row level security;
alter table public.agendamentos enable row level security;
alter table public.agendamento_alteracoes enable row level security;
alter table public.auditoria enable row level security;

-- catálogo público (site e chatbot)
create policy leitura_publica on public.horarios_funcionamento for select using (true);
create policy leitura_publica on public.servicos for select using (ativo or app.eh_equipe());
create policy leitura_publica on public.sintomas for select using (ativo or app.eh_equipe());
create policy leitura_equipe on public.configuracao for select using (app.eh_equipe());
create policy leitura_equipe on public.capacidade_diaria for select using (app.eh_equipe());
create policy leitura_equipe on public.recursos for select using (app.eh_equipe());

-- administração do catálogo e da agenda
create policy admin_escreve on public.servicos for all using (app.papel_atual() = 'admin') with check (app.papel_atual() = 'admin');
create policy admin_escreve on public.sintomas for all using (app.papel_atual() = 'admin') with check (app.papel_atual() = 'admin');
create policy admin_escreve on public.horarios_funcionamento for all using (app.papel_atual() = 'admin') with check (app.papel_atual() = 'admin');
create policy admin_escreve on public.capacidade_diaria for all using (app.papel_atual() = 'admin') with check (app.papel_atual() = 'admin');
create policy admin_escreve on public.recursos for all using (app.papel_atual() = 'admin') with check (app.papel_atual() = 'admin');
create policy admin_escreve on public.configuracao for update using (app.papel_atual() = 'admin') with check (app.papel_atual() = 'admin');
create policy equipe_gerencia on public.bloqueios for all using (app.eh_equipe()) with check (app.eh_equipe());

-- pessoas
create policy proprio_ou_equipe on public.perfis for select using (id = auth.uid() or app.eh_equipe());
create policy admin_gerencia on public.perfis for update using (app.papel_atual() = 'admin') with check (app.papel_atual() = 'admin');
create policy proprio_ou_equipe on public.clientes for select using (perfil_id = auth.uid() or app.eh_equipe());
create policy proprio_ou_equipe on public.consentimentos for select using (cliente_id = app.cliente_atual() or app.eh_equipe());
create policy equipe on public.origens for select using (app.eh_equipe());
create policy proprio_ou_equipe on public.veiculos for select using (cliente_id = app.cliente_atual() or app.eh_equipe());
create policy proprio_ou_equipe on public.historico_servicos for select
  using (app.eh_equipe() or veiculo_id in (select v.id from public.veiculos v where v.cliente_id = app.cliente_atual()));
create policy equipe_escreve on public.historico_servicos for all using (app.eh_equipe()) with check (app.eh_equipe());

-- atendimento
create policy proprio_ou_equipe on public.solicitacoes for select using (cliente_id = app.cliente_atual() or app.eh_equipe());
create policy proprio_ou_equipe on public.solicitacao_eventos for select
  using (app.eh_equipe() or (visivel_cliente and solicitacao_id in (select s.id from public.solicitacoes s where s.cliente_id = app.cliente_atual())));
create policy equipe on public.notas_internas for select using (app.eh_equipe());
create policy proprio_ou_equipe on public.agendamentos for select
  using (app.eh_equipe() or solicitacao_id in (select s.id from public.solicitacoes s where s.cliente_id = app.cliente_atual()));
create policy equipe on public.agendamento_alteracoes for select using (app.eh_equipe());
create policy admin on public.auditoria for select using (app.papel_atual() = 'admin');

-- privilégios: leitura passa pelo RLS; escrita de clientes, pedidos e agenda só pelas funções acima
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.horarios_funcionamento, public.servicos, public.sintomas to anon;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.servicos, public.sintomas, public.horarios_funcionamento,
  public.capacidade_diaria, public.recursos, public.bloqueios, public.historico_servicos to authenticated;
grant update on public.configuracao, public.perfis to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke all on schema app from public;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
grant execute on function public.registrar_cliente, public.cadastrar_veiculo, public.criar_solicitacao,
  public.horarios_disponiveis, public.indicar_preferencia, public.atualizar_triagem,
  public.confirmar_agendamento, public.cancelar_agendamento to authenticated;
