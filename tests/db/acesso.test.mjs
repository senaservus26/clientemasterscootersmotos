// Testes da Etapa 4: perfis de acesso, gestão da equipe pelo administrador e link de acompanhamento sem login.
// Usa um banco próprio. Mesmas variáveis TEST_PG_*.
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
const DB = 'masterscooter_acesso';
const root = new URL('../../', import.meta.url);
const ler = (p) => readFileSync(new URL(p, root), 'utf8');

let pool;
const U = { admin: randomUUID(), atendente: randomUUID(), especialista: randomUUID(), ana: randomUUID(), novo: randomUUID() };
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
  await pool.query('insert into public.perfis (id, nome) values ($1, $2)', [U.ana, 'ana']);
  const c = await um(`insert into public.clientes (perfil_id, nome_completo, telefone) values ($1, 'Ana Souza', '13911110000') returning id`, [U.ana]);
  const v = await um(`insert into public.veiculos (cliente_id, marca, modelo, ano, quilometragem, placa) values ($1, 'Honda', 'PCX', 2022, 15000, 'ABC1D23') returning id`, [c.id]);
  const s = await um(`insert into public.solicitacoes (protocolo, cliente_id, veiculo_id, descricao, quilometragem) values ('x', $1, $2, 'Barulho na transmissão ao acelerar', 15000) returning id, protocolo`, [c.id, v.id]);
  await pool.query(`insert into public.solicitacao_eventos (solicitacao_id, status_novo, descricao, visivel_cliente) values ($1, 'recebida', 'Pedido recebido', true), ($1, 'recebida', 'Cliente parece irritado', false)`, [s.id]);
  D.cliente = c.id; D.sol = s.id; D.protocolo = s.protocolo;
});
after(async () => { await pool?.end(); });

test('só o administrador vê e gerencia a equipe', async () => {
  const r = await como(U.admin, 'select * from public.listar_equipe()');
  assert.deepEqual(r.rows.map((x) => x.papel).sort(), ['admin', 'atendente', 'especialista']);
  assert.ok(r.rows.every((x) => x.email.endsWith('@exemplo.test')));
  for (const quem of [U.atendente, U.especialista, U.ana]) {
    await falha(como(quem, 'select * from public.listar_equipe()'), /Somente o administrador/);
    await falha(como(quem, `select public.definir_perfil_equipe('novo@exemplo.test', 'atendente', 'Novo')`), /Somente o administrador/);
    await falha(como(quem, 'select public.definir_acesso($1, false)', [U.atendente]), /Somente o administrador/);
  }
  await falha(como(null, 'select * from public.listar_equipe()'), /permission denied/);
});

test('ninguém altera perfis direto na tabela, nem para se promover', async () => {
  await falha(como(U.ana, `update public.perfis set papel = 'admin' where id = $1`, [U.ana]), /permission denied/);
  await falha(como(U.admin, `update public.perfis set ativo = false where id = $1`, [U.atendente]), /permission denied/);
});

test('administrador inclui pessoa que já entrou uma vez, troca o perfil e tira da equipe com registro em auditoria', async () => {
  await falha(como(U.admin, `select public.definir_perfil_equipe('ninguem@exemplo.test', 'atendente', 'Ninguém')`), /ainda não entrou/);
  await falha(como(U.admin, `select public.definir_perfil_equipe('novo@exemplo.test', 'atendente', 'x')`), /Informe o nome/);
  const r = await como(U.admin, `select public.definir_perfil_equipe(' NOVO@exemplo.test ', 'atendente', 'Carla Nova') as id`);
  assert.equal(r.rows[0].id, U.novo);
  assert.equal((await um('select papel from public.perfis where id = $1', [U.novo])).papel, 'atendente');
  await como(U.admin, `select public.definir_perfil_equipe('novo@exemplo.test', 'especialista', 'Carla Nova')`);
  assert.equal((await um('select papel from public.perfis where id = $1', [U.novo])).papel, 'especialista');
  await como(U.admin, `select public.definir_perfil_equipe('novo@exemplo.test', 'cliente', 'Carla Nova')`);
  const lista = await como(U.admin, 'select id from public.listar_equipe()');
  assert.ok(!lista.rows.some((x) => x.id === U.novo));
  const aud = await um(`select count(*)::int n from public.auditoria where tabela = 'perfis' and registro_id = $1 and autor_id = $2`, [U.novo, U.admin]);
  assert.equal(aud.n, 3);
});

test('administrador não muda o próprio perfil e a oficina nunca fica sem administrador ativo', async () => {
  await falha(como(U.admin, `select public.definir_perfil_equipe('admin@exemplo.test', 'atendente', 'Eu')`), /próprio perfil/);
  await falha(como(U.admin, 'select public.definir_acesso($1, false)', [U.admin]), /próprio acesso/);
  await falha(pool.query(`update public.perfis set ativo = false where id = $1`, [U.admin]), /pelo menos um administrador/);
  await falha(pool.query(`delete from public.perfis where id = $1`, [U.admin]), /pelo menos um administrador/);
});

test('pessoa desativada perde o acesso da equipe na hora e volta quando reativada', async () => {
  assert.equal((await como(U.atendente, 'select count(*)::int n from public.solicitacoes')).rows[0].n, 1);
  await como(U.admin, 'select public.definir_acesso($1, false)', [U.atendente]);
  assert.equal((await como(U.atendente, 'select count(*)::int n from public.solicitacoes')).rows[0].n, 0);
  await falha(como(U.atendente, 'select public.gerar_acesso_protocolo($1)', [D.sol]), /restrito à equipe/);
  await como(U.admin, 'select public.definir_acesso($1, true)', [U.atendente]);
  assert.equal((await como(U.atendente, 'select count(*)::int n from public.solicitacoes')).rows[0].n, 1);
});

test('cliente desativado deixa de ver os próprios dados', async () => {
  assert.equal((await como(U.ana, 'select count(*)::int n from public.solicitacoes')).rows[0].n, 1);
  await como(U.admin, 'select public.definir_acesso($1, false)', [U.ana]);
  assert.equal((await como(U.ana, 'select count(*)::int n from public.solicitacoes')).rows[0].n, 0);
  assert.equal((await como(U.ana, 'select count(*)::int n from public.veiculos')).rows[0].n, 0);
  await como(U.admin, 'select public.definir_acesso($1, true)', [U.ana]);
  assert.equal((await como(U.ana, 'select count(*)::int n from public.solicitacoes')).rows[0].n, 1);
});

test('link de acompanhamento: só a equipe gera, o banco guarda só o hash e a consulta não mostra dados pessoais', async () => {
  await falha(como(U.ana, 'select public.gerar_acesso_protocolo($1)', [D.sol]), /restrito à equipe/);
  await falha(como(null, 'select public.gerar_acesso_protocolo($1)', [D.sol]), /permission denied/);
  const token = (await como(U.atendente, 'select public.gerar_acesso_protocolo($1) t', [D.sol])).rows[0].t;
  assert.match(token, /^[0-9a-f]{64}$/);
  const guardado = await um('select token_hash, expira_em > now() + interval \'29 days\' as prazo from public.acessos_protocolo where solicitacao_id = $1 and revogado_em is null', [D.sol]);
  assert.notEqual(guardado.token_hash.toString('hex'), token);
  assert.ok(guardado.prazo);
  await falha(como(null, 'select * from public.acessos_protocolo'), /permission denied/);

  const r = (await como(null, 'select public.consultar_protocolo($1) j', [token])).rows[0].j;
  assert.equal(r.protocolo, D.protocolo);
  assert.equal(r.moto, 'Honda PCX');
  assert.deepEqual(r.eventos.map((e) => e.descricao), ['Pedido recebido']);
  const texto = JSON.stringify(r);
  for (const segredo of ['Ana', '13911110000', 'ABC1D23', 'irritado', 'Barulho']) assert.ok(!texto.includes(segredo), segredo);
  D.token = token;
});

test('link inválido, revogado ou substituído não abre nada', async () => {
  await falha(como(null, `select public.consultar_protocolo('abc')`), /Link inválido/);
  await falha(como(null, 'select public.consultar_protocolo($1)', ['0'.repeat(64)]), /Link inválido/);
  const novo = (await como(U.admin, 'select public.gerar_acesso_protocolo($1) t', [D.sol])).rows[0].t;
  await falha(como(null, 'select public.consultar_protocolo($1)', [D.token]), /Link inválido/);
  assert.equal((await como(null, 'select public.consultar_protocolo($1) j', [novo])).rows[0].j.protocolo, D.protocolo);
  await falha(como(U.ana, 'select public.revogar_acesso_protocolo($1)', [D.sol]), /restrito à equipe/);
  await como(U.atendente, 'select public.revogar_acesso_protocolo($1)', [D.sol]);
  await falha(como(null, 'select public.consultar_protocolo($1)', [novo]), /Link inválido/);
  const ultimo = (await como(U.admin, 'select public.gerar_acesso_protocolo($1) t', [D.sol])).rows[0].t;
  await pool.query(`update public.acessos_protocolo set criado_em = now() - interval '31 days', expira_em = now() - interval '1 minute' where revogado_em is null`);
  await falha(como(null, 'select public.consultar_protocolo($1)', [ultimo]), /Link inválido/);
});
