// Testes do modelo da Etapa 2: OS, orçamento, aprovação, pagamento, triagem, recorrência e mensagens.
// Usa um banco próprio para rodar em paralelo com regras.test.mjs. Mesmas variáveis TEST_PG_*.
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
const DB = 'masterscooter_modelo';
const root = new URL('../../', import.meta.url);
const ler = (p) => readFileSync(new URL(p, root), 'utf8');

let pool;
const U = { admin: randomUUID(), atendente: randomUUID(), especialista: randomUUID(), ana: randomUUID(), bruno: randomUUID() };
const D = {};

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
const um = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

before(async () => {
  const adm = new pg.Client({ ...conn, database: 'postgres' });
  await adm.connect();
  await adm.query(`drop database if exists ${DB} with (force)`);
  await adm.query(`create database ${DB}`);
  await adm.end();
  pool = new pg.Pool({ ...conn, database: DB, max: 4 });
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
  for (const [nome, tel] of [['ana', '13911110000'], ['bruno', '13922220000']]) {
    await pool.query('insert into public.perfis (id, nome) values ($1, $2)', [U[nome], nome]);
    const c = await um('insert into public.clientes (perfil_id, nome_completo, telefone) values ($1, $2, $3) returning id', [U[nome], `Cliente ${nome}`, tel]);
    const v = await um(`insert into public.veiculos (cliente_id, marca, modelo, ano, quilometragem) values ($1, 'Honda', 'PCX', 2022, 15000) returning id`, [c.id]);
    const s = await um(`insert into public.solicitacoes (protocolo, cliente_id, veiculo_id, descricao, quilometragem) values ('x', $1, $2, 'Barulho na transmissão ao acelerar', 15000) returning id`, [c.id, v.id]);
    D[nome] = { cliente: c.id, veiculo: v.id, sol: s.id };
  }
  // Ana aceitou lembretes; Bruno não
  await pool.query(`insert into public.consentimentos (cliente_id, tipo, versao_texto, aceito, canal) values ($1, 'lembretes', 'v1', true, 'site'), ($2, 'lembretes', 'v1', false, 'site')`, [D.ana.cliente, D.bruno.cliente]);
  const os = await um(`insert into public.ordens_servico (solicitacao_id, veiculo_id, km_entrada, reclamacao) values ($1, $2, 15010, 'Barulho no CVT') returning id, numero`, [D.ana.sol, D.ana.veiculo]);
  D.os = os.id; D.numeroOs = os.numero;
});
after(async () => { await pool?.end(); });

test('todas as tabelas do sistema têm segurança por linha ativa', async () => {
  const r = await pool.query(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
  assert.deepEqual(r.rows, []);
});

test('OS recebe número gerado no banco', () => {
  assert.match(D.numeroOs, /^OS-\d{4}-\d{5}$/);
});

test('item do orçamento só é executado depois da aprovação do cliente', async () => {
  await falha(pool.query(`insert into public.os_itens (os_id, tipo, descricao, valor_unitario_centavos, estado) values ($1, 'servico', 'Troca da correia', 18000, 'executado')`, [D.os]), /aprovado/);
  const item = await um(`insert into public.os_itens (os_id, tipo, descricao, valor_unitario_centavos) values ($1, 'servico', 'Troca da correia', 18000) returning id`, [D.os]);
  await falha(pool.query(`update public.os_itens set estado = 'aprovado' where id = $1`, [item.id]), /os_item_decisao_registrada/);
  await falha(pool.query(`update public.os_itens set estado = 'executado', executado_em = now(), executado_por = $2 where id = $1`, [item.id, U.especialista]), /aprovado/);
  const ap = await um(`insert into public.aprovacoes (os_id, canal, descricao, registrado_por) values ($1, 'whatsapp', 'Cliente aprovou a troca da correia', $2) returning id`, [D.os, U.atendente]);
  await pool.query(`update public.os_itens set estado = 'aprovado', aprovacao_id = $2 where id = $1`, [item.id, ap.id]);
  await falha(pool.query(`update public.os_itens set valor_unitario_centavos = 25000 where id = $1`, [item.id]), /não pode mudar de valor/);
  await pool.query(`update public.os_itens set estado = 'executado', executado_em = now(), executado_por = $2 where id = $1`, [item.id, U.especialista]);
  D.item = item.id;
});

test('concluir não é pagar: a situação vem dos pagamentos registrados', async () => {
  await pool.query(`update public.ordens_servico set estado = 'pronta', concluida_em = now() where id = $1`, [D.os]);
  let f = await um('select situacao, total_executado_centavos from public.os_financeiro where os_id = $1', [D.os]);
  assert.equal(f.situacao, 'pendente');
  assert.equal(Number(f.total_executado_centavos), 18000);
  await pool.query(`insert into public.pagamentos (os_id, valor_centavos, forma) values ($1, 8000, 'pix')`, [D.os]);
  f = await um('select situacao from public.os_financeiro where os_id = $1', [D.os]);
  assert.equal(f.situacao, 'parcial');
  await pool.query(`insert into public.pagamentos (os_id, valor_centavos, forma) values ($1, 10000, 'debito')`, [D.os]);
  f = await um('select situacao, total_pago_centavos from public.os_financeiro where os_id = $1', [D.os]);
  assert.equal(f.situacao, 'pago');
  await falha(pool.query(`update public.ordens_servico set estado = 'entregue' where id = $1`, [D.os]), /check/);
});

test('cliente vê a própria OS, itens e pagamentos; outro cliente não vê nada', async () => {
  const ana = await como(U.ana, 'select numero from public.ordens_servico');
  assert.equal(ana.rows.length, 1);
  assert.equal((await como(U.ana, 'select * from public.os_itens')).rows.length, 1);
  assert.equal((await como(U.ana, 'select * from public.os_financeiro')).rows[0].situacao, 'pago');
  for (const t of ['ordens_servico', 'os_itens', 'pagamentos', 'aprovacoes', 'os_financeiro']) {
    assert.equal((await como(U.bruno, `select * from public.${t}`)).rows.length, 0, t);
  }
  assert.equal((await como(U.atendente, 'select * from public.ordens_servico')).rows.length, 1);
  await falha(como(U.ana, `insert into public.pagamentos (os_id, valor_centavos, forma) values ('${D.os}', 100, 'pix')`), /permission denied/);
});

test('prioridade: sugestão automática é preliminar e só o especialista confirma, com justificativa', async () => {
  const s = await um(`select * from app.sugerir_prioridade(array['ruido', 'freio-fraco'], null)`);
  assert.deepEqual([s.classe, s.criterio], ['emergencial', 'sintoma de risco informado']);
  assert.equal((await um(`select classe from app.sugerir_prioridade(array[]::text[], 'revisao-geral')`)).classe, 'preventiva');
  assert.equal((await um(`select classe from app.sugerir_prioridade(array['nao-liga'], null)`)).classe, 'prioritaria');

  const t = await um(`insert into public.triagens (solicitacao_id, prioridade_sugerida, criterio_sugestao) values ($1, 'emergencial', 'sintoma de risco informado') returning id`, [D.bruno.sol]);
  await falha(pool.query(`update public.triagens set prioridade_confirmada = 'programavel', avaliado_por = $2, avaliado_em = now() where id = $1`, [t.id, U.especialista]), /triagem_confirmada_completa/);
  // atendente não confirma, mesmo gravando direto (o gatilho vale para qualquer caminho)
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [U.atendente]);
    await falha(c.query(`update public.triagens set prioridade_confirmada = 'programavel', justificativa = 'Freio ok no teste', avaliado_por = $2, avaliado_em = now() where id = $1`, [t.id, U.atendente]), /especialista/);
    await c.query('rollback');
    await c.query('begin');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [U.especialista]);
    await c.query(`update public.triagens set prioridade_confirmada = 'programavel', justificativa = 'Freio testado na bancada, sem perda de eficiência', avaliado_por = $2, avaliado_em = now() where id = $1`, [t.id, U.especialista]);
    await c.query('commit');
  } finally { c.release(); }
  const r = await um('select prioridade_sugerida, prioridade_confirmada from public.triagens where id = $1', [t.id]);
  assert.deepEqual([r.prioridade_sugerida, r.prioridade_confirmada], ['emergencial', 'programavel']);
  assert.equal((await como(U.bruno, 'select * from public.triagens')).rows.length, 0);
});

test('recomendação exige data ou km e aparece na linha do tempo da moto', async () => {
  await falha(pool.query(`insert into public.recomendacoes (veiculo_id, descricao, base_tecnica) values ($1, 'Trocar roletes', 'avaliacao_tecnica')`, [D.ana.veiculo]), /recomendacao_tem_prazo/);
  await pool.query(`insert into public.recomendacoes (veiculo_id, os_id, descricao, km_previsto, base_tecnica) values ($1, $2, 'Trocar roletes do CVT', 25000, 'avaliacao_tecnica')`, [D.ana.veiculo, D.os]);
  const tl = await como(U.ana, 'select tipo from public.linha_do_tempo where veiculo_id = $1 order by quando', [D.ana.veiculo]);
  const tipos = tl.rows.map((x) => x.tipo);
  for (const t of ['solicitacao', 'entrada', 'servico_executado', 'recomendacao']) assert.ok(tipos.includes(t), t);
  assert.equal((await como(U.bruno, 'select * from public.linha_do_tempo where veiculo_id = $1', [D.ana.veiculo])).rows.length, 0);
});

test('lembrete preventivo só para quem consentiu; mensagem de teste nunca finge envio', async () => {
  await pool.query(`insert into public.mensagens (cliente_id, modelo_slug, modo) values ($1, 'lembrete_preventivo', 'teste')`, [D.ana.cliente]);
  await falha(pool.query(`insert into public.mensagens (cliente_id, modelo_slug, modo) values ($1, 'lembrete_preventivo', 'teste')`, [D.bruno.cliente]), /consentimento/);
  await pool.query(`insert into public.mensagens (cliente_id, modelo_slug, modo) values ($1, 'recebimento', 'teste')`, [D.bruno.cliente]);
  await falha(pool.query(`insert into public.mensagens (cliente_id, modelo_slug, modo, id_externo) values ($1, 'recebimento', 'teste', 'wamid.x')`, [D.ana.cliente]), /mensagem_teste_nao_sai/);
  await falha(pool.query(`insert into public.mensagens (cliente_id, modelo_slug, modo, estado) values ($1, 'recebimento', 'real', 'entregue')`, [D.ana.cliente]), /mensagem_enviada_tem_prova/);
  assert.equal((await como(U.ana, 'select * from public.mensagens')).rows.length, 0);
});

test('lista de espera: uma entrada ativa por solicitação', async () => {
  await pool.query(`insert into public.lista_espera (solicitacao_id, desde, ate) values ($1, current_date, current_date + 7)`, [D.bruno.sol]);
  await falha(pool.query(`insert into public.lista_espera (solicitacao_id, desde, ate) values ($1, current_date, current_date + 3)`, [D.bruno.sol]), /lista_espera_uma_ativa/);
  assert.equal((await como(U.bruno, 'select * from public.lista_espera')).rows.length, 1);
  assert.equal((await como(U.ana, 'select * from public.lista_espera')).rows.length, 0);
});

test('alterações nas novas tabelas entram na auditoria', async () => {
  const r = await pool.query(`select distinct tabela from public.auditoria where tabela in ('ordens_servico', 'os_itens', 'pagamentos', 'triagens', 'aprovacoes')`);
  assert.equal(r.rows.length, 5);
});
