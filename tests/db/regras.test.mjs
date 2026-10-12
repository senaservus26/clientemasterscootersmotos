// Testes das regras do banco num PostgreSQL real (sem Supabase): acesso, prioridade e agenda.
// Requer um PostgreSQL 16 local. Padrão: socket em /tmp/pg, porta 54329, usuário postgres.
// Para outro servidor, defina TEST_PG_HOST, TEST_PG_PORT, TEST_PG_USER e TEST_PG_PASSWORD.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const conn = {
  host: process.env.TEST_PG_HOST ?? '/tmp/pg',
  port: Number(process.env.TEST_PG_PORT ?? 54329),
  user: process.env.TEST_PG_USER ?? 'postgres',
  password: process.env.TEST_PG_PASSWORD,
};
const DB = 'masterscooter_teste';
const root = new URL('../../', import.meta.url);
const ler = (p) => readFileSync(new URL(p, root), 'utf8');

let pool;
const U = { admin: randomUUID(), atendente: randomUUID(), especialista: randomUUID(), ana: randomUUID(), bruno: randomUUID() };
let dia; // próximo dia útil com pelo menos 2 dias de antecedência (AAAA-MM-DD)
const ts = (hora) => `(('${dia}'::date + time '${hora}') at time zone 'America/Sao_Paulo')`;

async function como(uid, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (uid) await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await c.query(uid ? 'set local role authenticated' : 'set local role anon');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const falha = (promessa, trecho) => assert.rejects(promessa, (e) => {
  assert.match(e.message, trecho);
  return true;
});

before(async () => {
  const adm = new pg.Client({ ...conn, database: 'postgres' });
  await adm.connect();
  await adm.query(`drop database if exists ${DB} with (force)`);
  await adm.query(`create database ${DB}`);
  await adm.end();
  pool = new pg.Pool({ ...conn, database: DB, max: 6 });
  await pool.query(ler('tests/db/supabase-shim.sql'));
  for (const f of readdirSync(new URL('supabase/migrations/', root)).sort()) {
    await pool.query(ler(`supabase/migrations/${f}`));
  }
  await pool.query(ler('supabase/seed.sql'));
  for (const [nome, id] of Object.entries(U)) {
    await pool.query('insert into auth.users (id, email) values ($1, $2)', [id, `${nome}@exemplo.test`]);
  }
  for (const papel of ['admin', 'atendente', 'especialista']) {
    await pool.query('insert into public.perfis (id, papel, nome) values ($1, $2, $3)', [U[papel], papel, `Equipe ${papel}`]);
  }
  const r = await pool.query(`select to_char(d, 'YYYY-MM-DD') as d from generate_series(current_date + 2, current_date + 12, interval '1 day') d
                              where extract(dow from d) between 1 and 5 order by d limit 1`);
  dia = r.rows[0].d;
});
after(async () => { await pool?.end(); });

const estado = {};

test('1. cliente se cadastra com aceite de privacidade registrado', async () => {
  await falha(como(U.ana, `select public.registrar_cliente('Ana Teste', '13912345678', null, 'whatsapp', false, false, 'v1')`), /privacidade/);
  const r = await como(U.ana, `select public.registrar_cliente('Ana Teste', '(13) 91234-5678', 'ana@exemplo.test', 'whatsapp', true, true, 'privacidade-v1', 'instagram', '{"utm_source":"instagram","utm_campaign":"lancamento"}')`);
  estado.anaCliente = r.rows[0].registrar_cliente;
  const c = await como(U.ana, 'select tipo, aceito, versao_texto from public.consentimentos order by tipo');
  assert.deepEqual(c.rows.map((x) => x.tipo), ['lembretes', 'privacidade']);
  assert.equal(c.rows[1].versao_texto, 'privacidade-v1');
  await falha(como(U.bruno, `select public.registrar_cliente('Bruno Teste', '13912345678', null, 'whatsapp', true, false, 'v1')`), /telefone já tem cadastro/);
  await como(U.bruno, `select public.registrar_cliente('Bruno Teste', '13998765432', null, 'whatsapp', true, false, 'v1')`);
});

test('2. cliente cadastra a scooter; dados inválidos são recusados', async () => {
  await falha(como(U.ana, `select public.cadastrar_veiculo('Honda', 'PCX 160', 2099, 5000)`), /Ano/);
  await falha(como(U.ana, `select public.cadastrar_veiculo('Honda', 'PCX 160', 2022, -1)`), /quilometragem/);
  const r = await como(U.ana, `select public.cadastrar_veiculo('Honda', 'PCX 160', 2022, 18400, 'abc-1d23')`);
  estado.anaVeiculo = r.rows[0].cadastrar_veiculo;
  const v = await como(U.ana, 'select placa from public.veiculos');
  assert.equal(v.rows[0].placa, 'ABC1D23');
  const b = await como(U.bruno, `select public.cadastrar_veiculo('Yamaha', 'NMax 160', 2021, 32000)`);
  estado.brunoVeiculo = b.rows[0].cadastrar_veiculo;
});

test('3. solicitação gera protocolo no banco e marca sintoma de risco', async () => {
  await falha(como(U.ana, `select * from public.criar_solicitacao($1, 'freios', 'Freio traseiro chiando ao parar.', array['freio-fraco'], 'há uma semana', 100, null)`, [estado.anaVeiculo]), /menor que a já registrada/);
  await falha(como(U.bruno, `select * from public.criar_solicitacao($1, 'freios', 'Tentando usar a moto de outra pessoa.', '{}', null, 99999, null)`, [estado.anaVeiculo]), /não encontrada/);
  const r = await como(U.ana, `select * from public.criar_solicitacao($1, 'freios', 'Freio traseiro chiando ao parar.', array['freio-fraco'], 'há uma semana', 18500, 'manhãs')`, [estado.anaVeiculo]);
  const s = r.rows[0];
  assert.match(s.protocolo, /^MS-\d{4}-\d{6}$/);
  assert.equal(s.status, 'recebida');
  assert.equal(s.sintoma_risco, true);
  estado.anaSol = s.id;
});

test('4. a solicitação aparece para a equipe e para mais ninguém', async () => {
  const equipe = await como(U.atendente, 'select protocolo from public.solicitacoes');
  assert.equal(equipe.rowCount, 1);
  const bruno = await como(U.bruno, 'select * from public.solicitacoes');
  assert.equal(bruno.rowCount, 0);
  const brunoClientes = await como(U.bruno, 'select nome_completo from public.clientes');
  assert.deepEqual(brunoClientes.rows.map((x) => x.nome_completo), ['Bruno Teste']);
  await falha(como(null, 'select * from public.solicitacoes'), /permission denied/);
  await falha(como(U.ana, `update public.solicitacoes set status = 'concluido'`), /permission denied/);
});

test('5. só o especialista define a prioridade; a avaliação continua humana', async () => {
  await falha(como(U.atendente, `select public.atualizar_triagem($1, 'aguardando_agendamento', 'alta', 'freios', 60)`, [estado.anaSol]), /Somente o especialista/);
  await falha(como(U.ana, `select public.atualizar_triagem($1, 'aguardando_agendamento', 'baixa', 'freios', 60)`, [estado.anaSol]), /restrito à equipe/);
  await falha(como(U.especialista, `select public.atualizar_triagem($1, 'agendado', 'alta', 'freios', 60)`, [estado.anaSol]), /confirme um horário/);
  await como(U.especialista, `select public.atualizar_triagem($1, 'aguardando_agendamento', 'alta', 'freios', 60, 'Verificar pastilhas e disco.')`, [estado.anaSol]);
  const s = await como(U.especialista, 'select status, prioridade, responsavel_id from public.solicitacoes where id = $1', [estado.anaSol]);
  assert.equal(s.rows[0].prioridade, 'alta');
  assert.equal(s.rows[0].responsavel_id, U.especialista);
  // o atendente pode mudar status sem mexer na prioridade
  await como(U.atendente, `select public.atualizar_triagem($1, 'aguardando_agendamento', 'alta', 'freios', 60)`, [estado.anaSol]);
});

test('6–7. cliente vê horários livres reais e indica uma preferência', async () => {
  const h = await como(U.ana, `select to_char(inicio at time zone 'America/Sao_Paulo', 'HH24:MI') as h from public.horarios_disponiveis($1, 'freios')`, [dia]);
  const horas = h.rows.map((x) => x.h);
  assert.equal(horas[0], '08:00');
  assert.equal(horas.at(-1), '17:00'); // serviço de 1 h termina até 18:00
  const domingo = await como(U.ana, `select count(*)::int as n from public.horarios_disponiveis(($1::date + (7 - extract(dow from $1::date))::int), 'freios')`, [dia]);
  assert.equal(domingo.rows[0].n, 0);
  await falha(como(U.ana, `select public.indicar_preferencia($1, ${ts('19:00')})`, [estado.anaSol]), /Fora do horário/);
  await como(U.ana, `select public.indicar_preferencia($1, ${ts('10:00')})`, [estado.anaSol]);
});

test('8–10. a oficina confirma; cliente e agenda veem o compromisso', async () => {
  await falha(como(U.ana, `select public.confirmar_agendamento($1, ${ts('10:00')})`, [estado.anaSol]), /Somente a equipe/);
  await como(U.atendente, `select public.confirmar_agendamento($1, ${ts('10:00')})`, [estado.anaSol]);
  const cli = await como(U.ana, `select s.status, to_char(lower(a.periodo) at time zone 'America/Sao_Paulo', 'HH24:MI') as h
                                 from public.solicitacoes s join public.agendamentos a on a.solicitacao_id = s.id`);
  assert.deepEqual(cli.rows[0], { status: 'agendado', h: '10:00' });
  const agenda = await como(U.especialista, `select r.nome from public.agendamentos a join public.recursos r on r.id = a.recurso_id where a.estado = 'confirmado'`);
  assert.deepEqual(agenda.rows.map((x) => x.nome), ['Box 1']);
  const evs = await como(U.ana, 'select descricao from public.solicitacao_eventos order by id');
  assert.ok(evs.rows.some((e) => /Agendado para/.test(e.descricao ?? '')));
});

async function novaSolicitacaoBruno(texto) {
  const r = await como(U.bruno, `select id from public.criar_solicitacao($1, 'motor', $2, '{}', null, 32000, null)`, [estado.brunoVeiculo, texto]);
  await como(U.especialista, `select public.atualizar_triagem($1, 'aguardando_agendamento', 'media', 'motor', 60)`, [r.rows[0].id]);
  return r.rows[0].id;
}

test('11. o sistema impede agendamento conflitante, inclusive simultâneo', async () => {
  const s2 = await novaSolicitacaoBruno('Troca de óleo e filtro, por favor.');
  const s3 = await novaSolicitacaoBruno('Vela e limpeza do carburador.');
  await como(U.atendente, `select public.confirmar_agendamento($1, ${ts('10:00')})`, [s2]); // ocupa o Box 2
  await falha(como(U.atendente, `select public.confirmar_agendamento($1, ${ts('10:00')})`, [s3]), /boxes estão ocupados/);

  // duas confirmações ao mesmo tempo, para o mesmo horário, com os dois boxes livres para só uma delas
  const s4 = await novaSolicitacaoBruno('Revisão das velas e do filtro de ar.');
  await como(U.atendente, `select public.confirmar_agendamento($1, ${ts('14:00')})`, [s4]); // sobra um box às 14h
  const s5 = await novaSolicitacaoBruno('Óleo do motor vencido há meses.');
  const corrida = await Promise.allSettled([
    como(U.atendente, `select public.confirmar_agendamento($1, ${ts('14:00')})`, [s3]),
    como(U.especialista, `select public.confirmar_agendamento($1, ${ts('14:00')})`, [s5]),
  ]);
  assert.equal(corrida.filter((x) => x.status === 'fulfilled').length, 1);
  assert.match(corrida.find((x) => x.status === 'rejected').reason.message, /boxes estão ocupados/);

  // mesmo inserindo direto no banco, a restrição de exclusão barra a sobreposição
  await falha(pool.query(`insert into public.agendamentos (solicitacao_id, recurso_id, periodo)
                          select $1, r.id, tstzrange(${ts('14:30')}, ${ts('15:00')}) from public.recursos r where r.nome = 'Box 1'`, [s2]),
              /agendamentos_sem_sobreposicao|agendamentos_um_confirmado/);
});

test('bloqueios e capacidade diária tiram horários da vitrine', async () => {
  await como(U.atendente, `insert into public.bloqueios (periodo, motivo) values (tstzrange(${ts('16:00')}, ${ts('18:00')}), 'Treinamento da equipe')`);
  const h = await como(U.ana, `select to_char(inicio at time zone 'America/Sao_Paulo', 'HH24:MI') as h from public.horarios_disponiveis($1, 'freios')`, [dia]);
  const horas = h.rows.map((x) => x.h);
  assert.ok(!horas.includes('16:00') && !horas.includes('17:00'));
  assert.ok(!horas.includes('10:00') && !horas.includes('14:00'));
  await pool.query(`insert into public.capacidade_diaria (dia_semana, limite) values (extract(dow from $1::date), 4)`, [dia]);
  const lotado = await como(U.ana, `select count(*)::int as n from public.horarios_disponiveis($1, 'freios')`, [dia]);
  assert.equal(lotado.rows[0].n, 0);
  await pool.query('delete from public.capacidade_diaria');
});

test('12. histórico disponível só para o dono e a equipe; notas internas nunca para o cliente', async () => {
  const ana = await como(U.ana, 'select descricao from public.solicitacao_eventos');
  assert.ok(ana.rowCount >= 3);
  assert.ok(!ana.rows.some((e) => /Prioridade/.test(e.descricao ?? '')));
  const notas = await como(U.ana, 'select * from public.notas_internas');
  assert.equal(notas.rowCount, 0);
  const notasEquipe = await como(U.especialista, 'select texto from public.notas_internas');
  assert.equal(notasEquipe.rows[0].texto, 'Verificar pastilhas e disco.');
  const brunoVeAna = await como(U.bruno, 'select * from public.solicitacao_eventos where solicitacao_id = $1', [estado.anaSol]);
  assert.equal(brunoVeAna.rowCount, 0);
  const brunoAgenda = await como(U.bruno, 'select * from public.agendamentos where solicitacao_id = $1', [estado.anaSol]);
  assert.equal(brunoAgenda.rowCount, 0);
  const auditoriaCliente = await como(U.ana, 'select * from public.auditoria');
  assert.equal(auditoriaCliente.rowCount, 0);
  const auditoriaAdmin = await como(U.admin, `select count(*)::int as n from public.auditoria where tabela = 'agendamentos'`);
  assert.ok(auditoriaAdmin.rows[0].n >= 3);
});

test('agenda expõe início e fim prontos para a interface', async () => {
  const r = await como(U.ana, `select to_char(inicio at time zone 'America/Sao_Paulo', 'HH24:MI') as i, to_char(fim at time zone 'America/Sao_Paulo', 'HH24:MI') as f from public.agendamentos where solicitacao_id = $1`, [estado.anaSol]);
  assert.deepEqual(r.rows[0], { i: '10:00', f: '11:00' });
});
