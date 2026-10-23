-- Master Scooter Motos · Etapa 5: cadastro de clientes e motos, solicitação pelo balcão, fotos e vídeos
-- A equipe cadastra quem chega no balcão, por telefone ou WhatsApp, sem exigir login nem e-mail do cliente.

-- ---------------------------------------------------------------- consentimentos
alter table public.consentimentos drop constraint consentimentos_canal_check;
alter table public.consentimentos add constraint consentimentos_canal_check check (canal in ('site', 'whatsapp', 'balcao', 'telefone'));

-- situação atual de cada consentimento: vale o registro mais recente; o histórico continua guardado
create view public.consentimentos_atuais with (security_invoker = true) as
select distinct on (c.cliente_id, c.tipo) c.cliente_id, c.tipo, c.aceito, c.versao_texto, c.canal, c.registrado_em
from public.consentimentos c
order by c.cliente_id, c.tipo, c.registrado_em desc, c.id desc;

create function app.canal_consentimento(p_canal text) returns text
language sql immutable set search_path = '' as $$
  select case p_canal when 'whatsapp' then 'whatsapp' when 'telefone' then 'telefone' when 'balcao' then 'balcao' else 'site' end
$$;

-- o cliente muda as próprias preferências; a equipe registra o que o cliente pediu no balcão ou por telefone
create function public.definir_consentimento(p_tipo text, p_aceito boolean, p_versao_texto text, p_cliente uuid default null, p_canal text default 'site')
returns void language plpgsql security definer set search_path = '' as $$
declare v_cliente uuid;
begin
  if p_tipo not in ('lembretes', 'marketing') then perform app.erro('Preferência desconhecida.'); end if;
  if p_cliente is null then
    v_cliente := app.cliente_atual();
    if v_cliente is null then perform app.erro('Crie seu cadastro antes de escolher as preferências.'); end if;
  else
    if not app.eh_equipe() then perform app.erro('Acesso restrito à equipe da oficina.'); end if;
    v_cliente := p_cliente;
    if not exists (select 1 from public.clientes where id = v_cliente) then perform app.erro('Cliente não encontrado.'); end if;
  end if;
  insert into public.consentimentos (cliente_id, tipo, versao_texto, aceito, canal)
  values (v_cliente, p_tipo, coalesce(nullif(btrim(p_versao_texto), ''), 'sem-versao'), coalesce(p_aceito, false),
          case when p_cliente is null then 'site' else app.canal_consentimento(p_canal) end);
end $$;

-- ---------------------------------------------------------------- cadastro pela equipe
create function public.cadastrar_cliente_equipe(
  p_nome text, p_telefone text, p_email text, p_preferencia text, p_canal text, p_origem_canal text,
  p_ciente_privacidade boolean, p_aceite_lembretes boolean, p_aceite_marketing boolean, p_versao_texto text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g');
  v_canal text := app.canal_consentimento(p_canal);
  v_origem uuid;
  v_cliente uuid;
begin
  if not app.eh_equipe() then perform app.erro('Acesso restrito à equipe da oficina.'); end if;
  if p_canal not in ('balcao', 'telefone', 'whatsapp') then perform app.erro('Informe por onde o cliente chegou.'); end if;
  if not coalesce(p_ciente_privacidade, false) then
    perform app.erro('Confirme que o cliente foi informado sobre o uso dos dados (aviso de privacidade).');
  end if;
  if length(btrim(coalesce(p_nome, ''))) < 3 then perform app.erro('Informe o nome do cliente.'); end if;
  if v_tel !~ '^[0-9]{10,11}$' then perform app.erro('Informe o telefone com DDD.'); end if;
  if exists (select 1 from public.clientes where telefone = v_tel) then
    perform app.erro('Este telefone já tem cadastro. Busque o cliente pelo telefone.');
  end if;

  insert into public.origens (canal) values (coalesce(p_origem_canal, 'outro')) returning id into v_origem;
  insert into public.clientes (nome_completo, telefone, email, preferencia_contato, origem_id, cadastrado_por, canal_cadastro)
  values (btrim(p_nome), v_tel, nullif(lower(btrim(coalesce(p_email, ''))), ''), coalesce(p_preferencia, 'whatsapp'), v_origem, auth.uid(), p_canal)
  returning id into v_cliente;
  insert into public.consentimentos (cliente_id, tipo, versao_texto, aceito, canal) values
    (v_cliente, 'privacidade', p_versao_texto, true, v_canal),
    (v_cliente, 'lembretes', p_versao_texto, coalesce(p_aceite_lembretes, false), v_canal),
    (v_cliente, 'marketing', p_versao_texto, coalesce(p_aceite_marketing, false), v_canal);
  return v_cliente;
end $$;

-- cliente cadastrado no balcão que depois entra pelo site: a equipe liga o cadastro ao e-mail usado no login
create function public.vincular_login_cliente(p_cliente uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_cli public.clientes;
begin
  if not app.eh_equipe() then perform app.erro('Acesso restrito à equipe da oficina.'); end if;
  select * into v_cli from public.clientes where id = p_cliente for update;
  if not found then perform app.erro('Cliente não encontrado.'); end if;
  if v_cli.perfil_id is not null then perform app.erro('Este cliente já tem login.'); end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_uid is null then perform app.erro('Este e-mail ainda não entrou no site. Peça ao cliente para acessar “Entrar” uma vez.'); end if;
  if exists (select 1 from public.clientes where perfil_id = v_uid) then perform app.erro('Este login já pertence a outro cadastro.'); end if;
  if exists (select 1 from public.perfis where id = v_uid and papel <> 'cliente') then perform app.erro('Este e-mail é de alguém da equipe.'); end if;
  insert into public.perfis (id, papel, nome) values (v_uid, 'cliente', v_cli.nome_completo) on conflict (id) do nothing;
  update public.clientes set perfil_id = v_uid, email = coalesce(email, lower(btrim(p_email))) where id = v_cli.id;
end $$;

-- cadastro pelo site: se a oficina já cadastrou este telefone com o mesmo e-mail do login, liga os dois
create or replace function public.registrar_cliente(
  p_nome text, p_telefone text, p_email text, p_preferencia text,
  p_aceite_privacidade boolean, p_aceite_lembretes boolean, p_versao_texto text,
  p_origem_canal text default 'site', p_utm jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g');
  v_email_login text;
  v_existente public.clientes;
  v_cliente uuid;
  v_origem uuid;
begin
  if v_uid is null then perform app.erro('Entre com o código de acesso antes de criar o cadastro.'); end if;
  if not coalesce(p_aceite_privacidade, false) then perform app.erro('É preciso concordar com o aviso de privacidade.'); end if;
  if exists (select 1 from public.clientes where perfil_id = v_uid) then perform app.erro('Esta conta já tem cadastro.'); end if;
  select * into v_existente from public.clientes where telefone = v_tel;
  if found then
    select lower(u.email) into v_email_login from auth.users u where u.id = v_uid;
    if v_existente.perfil_id is null and v_existente.email is not null and lower(v_existente.email) = v_email_login then
      insert into public.perfis (id, papel, nome) values (v_uid, 'cliente', v_existente.nome_completo) on conflict (id) do nothing;
      update public.clientes set perfil_id = v_uid where id = v_existente.id;
      insert into public.consentimentos (cliente_id, tipo, versao_texto, aceito, canal) values
        (v_existente.id, 'privacidade', p_versao_texto, true, 'site'),
        (v_existente.id, 'lembretes', p_versao_texto, coalesce(p_aceite_lembretes, false), 'site');
      return v_existente.id;
    end if;
    perform app.erro('Este telefone já tem cadastro na oficina. Fale com a oficina para ligar o cadastro ao seu acesso.');
  end if;

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

-- ---------------------------------------------------------------- moto com os dados completos
-- p_cliente nulo = o próprio cliente logado; preenchido = a equipe cadastrando para ele
create function public.salvar_veiculo(
  p_cliente uuid, p_marca text, p_modelo text, p_ano integer, p_ano_modelo integer, p_km integer,
  p_placa text default null, p_ultima date default null, p_historico text default null, p_observacoes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_cliente uuid; v_id uuid;
begin
  if p_cliente is null then
    v_cliente := app.cliente_atual();
    if v_cliente is null then perform app.erro('Crie seu cadastro antes de registrar a scooter.'); end if;
  else
    if not app.eh_equipe() then perform app.erro('Acesso restrito à equipe da oficina.'); end if;
    v_cliente := p_cliente;
    if not exists (select 1 from public.clientes where id = v_cliente) then perform app.erro('Cliente não encontrado.'); end if;
  end if;
  if p_ano > extract(year from now())::int + 1 then perform app.erro('Ano da scooter inválido.'); end if;
  if p_ano_modelo is not null and p_ano_modelo not between p_ano and p_ano + 1 then
    perform app.erro('O ano do modelo é o mesmo da fabricação ou o seguinte.');
  end if;
  if p_ultima is not null and p_ultima > (now() at time zone app.tz())::date then
    perform app.erro('A data da última manutenção não pode ser no futuro.');
  end if;
  insert into public.veiculos (cliente_id, marca, modelo, ano, ano_modelo, quilometragem, placa, ultima_manutencao_em, historico_informado, observacoes)
  values (v_cliente, btrim(p_marca), btrim(p_modelo), p_ano, p_ano_modelo, p_km,
          nullif(upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g')), ''), p_ultima,
          nullif(btrim(coalesce(p_historico, '')), ''), nullif(btrim(coalesce(p_observacoes, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- solicitação: mesma regra pelo site e pelo balcão
create function app.criar_solicitacao_para(
  p_cliente uuid, p_veiculo uuid, p_servico_slug text, p_descricao text, p_sintomas text[],
  p_inicio_problema text, p_km integer, p_disponibilidade text, p_canal text
) returns table (id uuid, protocolo text, status public.status_solicitacao, sintoma_risco boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_veic public.veiculos;
  v_risco boolean;
  v_sol public.solicitacoes;
begin
  select * into v_veic from public.veiculos v where v.id = p_veiculo and v.cliente_id = p_cliente;
  if not found then perform app.erro('Scooter não encontrada no cadastro do cliente.'); end if;
  if p_km < v_veic.quilometragem then perform app.erro('A quilometragem não pode ser menor que a já registrada.'); end if;
  if exists (select 1 from unnest(coalesce(p_sintomas, '{}')) s where s not in (select slug from public.sintomas where ativo)) then
    perform app.erro('Sintoma desconhecido.');
  end if;
  select coalesce(bool_or(s.risco), false) into v_risco from public.sintomas s where s.slug = any(coalesce(p_sintomas, '{}'));

  update public.veiculos set quilometragem = p_km where veiculos.id = v_veic.id;
  insert into public.solicitacoes (protocolo, cliente_id, veiculo_id, servico_id, descricao, sintomas, inicio_problema,
                                   quilometragem, disponibilidade, sintoma_risco, origem_id)
  values ('pendente', p_cliente, v_veic.id, (select s.id from public.servicos s where s.slug = p_servico_slug and s.ativo),
          btrim(p_descricao), coalesce(p_sintomas, '{}'), nullif(btrim(coalesce(p_inicio_problema, '')), ''), p_km,
          nullif(btrim(coalesce(p_disponibilidade, '')), ''), v_risco,
          (select c.origem_id from public.clientes c where c.id = p_cliente))
  returning * into v_sol;
  perform app.registrar_evento(v_sol.id, null, 'recebida',
    case p_canal when 'site' then 'Solicitação registrada' else 'Solicitação registrada pela oficina (' || p_canal || ')' end, true, p_canal);
  return query select v_sol.id, v_sol.protocolo, v_sol.status, v_sol.sintoma_risco;
end $$;

create or replace function public.criar_solicitacao(
  p_veiculo uuid, p_servico_slug text, p_descricao text, p_sintomas text[],
  p_inicio_problema text, p_km integer, p_disponibilidade text, p_canal text default 'site'
) returns table (id uuid, protocolo text, status public.status_solicitacao, sintoma_risco boolean)
language plpgsql security definer set search_path = '' as $$
declare v_cliente uuid := app.cliente_atual();
begin
  if v_cliente is null then perform app.erro('Crie seu cadastro antes de abrir uma solicitação.'); end if;
  return query select * from app.criar_solicitacao_para(v_cliente, p_veiculo, p_servico_slug, p_descricao, p_sintomas,
                                                        p_inicio_problema, p_km, p_disponibilidade, 'site');
end $$;

create function public.abrir_solicitacao_equipe(
  p_cliente uuid, p_veiculo uuid, p_servico_slug text, p_descricao text, p_sintomas text[],
  p_inicio_problema text, p_km integer, p_disponibilidade text, p_canal text
) returns table (id uuid, protocolo text, status public.status_solicitacao, sintoma_risco boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if not app.eh_equipe() then perform app.erro('Acesso restrito à equipe da oficina.'); end if;
  if p_canal not in ('balcao', 'telefone', 'whatsapp') then perform app.erro('Informe por onde o cliente pediu o atendimento.'); end if;
  return query select * from app.criar_solicitacao_para(p_cliente, p_veiculo, p_servico_slug, p_descricao, p_sintomas,
                                                        p_inicio_problema, p_km, p_disponibilidade, p_canal);
end $$;

-- ---------------------------------------------------------------- fotos e vídeos (bucket privado "anexos")
-- caminho no bucket: <id da solicitação>/<nome aleatório>.<extensão>
create function app.pode_anexar(p_caminho text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_sol uuid;
begin
  if p_caminho !~ '^[0-9a-f-]{36}/[a-z0-9-]+\.(jpg|jpeg|png|webp|heic|mp4|mov)$' then return false; end if;
  v_sol := split_part(p_caminho, '/', 1)::uuid;
  return app.eh_equipe() or app.solicitacao_do_cliente(v_sol);
end $$;

create function public.registrar_anexo(p_solicitacao uuid, p_caminho text, p_tipo text, p_tamanho integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_status public.status_solicitacao;
begin
  if not (app.eh_equipe() or app.solicitacao_do_cliente(p_solicitacao)) then perform app.erro('Solicitação não encontrada.'); end if;
  if split_part(coalesce(p_caminho, ''), '/', 1) <> p_solicitacao::text or not app.pode_anexar(p_caminho) then
    perform app.erro('Arquivo inválido.');
  end if;
  if p_tipo not in ('foto', 'video') then perform app.erro('Envie uma foto ou um vídeo.'); end if;
  select s.status into v_status from public.solicitacoes s where s.id = p_solicitacao;
  if v_status in ('concluido', 'cancelado') and not app.eh_equipe() then perform app.erro('Solicitação encerrada.'); end if;
  if (select count(*) from public.anexos where solicitacao_id = p_solicitacao) >= 10 then
    perform app.erro('Limite de 10 arquivos por solicitação.');
  end if;
  if to_regclass('storage.objects') is not null then
    if not exists (select 1 from storage.objects o where o.bucket_id = 'anexos' and o.name = p_caminho) then
      perform app.erro('O arquivo não chegou ao armazenamento. Tente enviar de novo.');
    end if;
  end if;
  insert into public.anexos (solicitacao_id, momento, caminho, tipo, tamanho_bytes, enviado_por)
  values (p_solicitacao, 'solicitacao', p_caminho, p_tipo, p_tamanho, auth.uid())
  returning id into v_id;
  perform app.registrar_evento(p_solicitacao, v_status, v_status,
    case p_tipo when 'foto' then 'Foto enviada' else 'Vídeo enviado' end, true,
    case when app.eh_equipe() then 'balcao' else 'site' end);
  return v_id;
end $$;
create trigger auditoria_anexos after insert or update or delete on public.anexos for each row execute function app.auditar();

-- armazenamento: só existe no Supabase (nos testes locais, o shim cria um esquema "storage" mínimo)
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('anexos', 'anexos', false, 52428800,
          array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime'])
  on conflict (id) do nothing;
  execute $p$create policy anexos_envio on storage.objects for insert to authenticated
    with check (bucket_id = 'anexos' and app.pode_anexar(name))$p$;
  execute $p$create policy anexos_leitura on storage.objects for select to authenticated
    using (bucket_id = 'anexos' and app.pode_anexar(name))$p$;
end $$;

-- ---------------------------------------------------------------- permissões
revoke all on public.consentimentos_atuais from anon, authenticated;
grant select on public.consentimentos_atuais to authenticated;
revoke execute on function app.canal_consentimento, app.criar_solicitacao_para, app.pode_anexar from public;
grant execute on function app.canal_consentimento, app.pode_anexar to authenticated;
revoke execute on function public.definir_consentimento, public.cadastrar_cliente_equipe, public.vincular_login_cliente,
  public.salvar_veiculo, public.abrir_solicitacao_equipe, public.registrar_anexo from public, anon;
grant execute on function public.definir_consentimento, public.cadastrar_cliente_equipe, public.vincular_login_cliente,
  public.salvar_veiculo, public.abrir_solicitacao_equipe, public.registrar_anexo to authenticated;
-- o create or replace mantém as permissões já dadas a registrar_cliente e criar_solicitacao
