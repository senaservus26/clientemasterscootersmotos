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
  public.gerar_acesso_protocolo, public.revogar_acesso_protocolo, public.consultar_protocolo from public, anon;
-- no Supabase, funções novas do esquema public já nascem liberadas para anon; por isso o revoke explícito acima
grant execute on function public.listar_equipe, public.definir_perfil_equipe, public.definir_acesso,
  public.gerar_acesso_protocolo, public.revogar_acesso_protocolo to authenticated;
grant execute on function public.consultar_protocolo to anon, authenticated;
