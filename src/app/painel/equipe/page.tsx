import { exigirAdmin, PAPEIS, type Papel } from '@/lib/equipe';
import { dataHora } from '@/lib/rotulos';
import { alterarAcesso, salvarMembroEquipe } from '../actions';
import { Aviso, NavPainel } from '../navegacao';

export const metadata = { title: 'Equipe · Painel' };

type Membro = { id: string; nome: string; email: string; papel: Papel; ativo: boolean; criado_em: string };

const O_QUE_FAZ: Record<Papel, string> = {
  admin: 'Tudo, inclusive gerenciar a equipe e as configurações.',
  atendente: 'Recebe solicitações, faz a triagem inicial e confirma horários. Não define prioridade.',
  especialista: 'Avalia, confirma a prioridade e conduz o serviço.',
};

export default async function Equipe({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, nome, user } = await exigirAdmin();
  const sp = await searchParams;
  const { data, error } = await supabase.rpc('listar_equipe');
  const equipe = (data ?? []) as Membro[];

  return (
    <div className="wrap page">
      <NavPainel atual="equipe" nome={nome} admin />
      <Aviso ok={sp.ok} erro={sp.erro ?? (error ? 'Não foi possível carregar a equipe.' : undefined)} />

      <div className="cols" style={{ marginTop: 12 }}>
        <div className="panel stack">
          <p className="label">Equipe da oficina</p>
          {equipe.length ? (
            <table className="tabela">
              <thead><tr><th>Pessoa</th><th>Perfil</th><th>Acesso</th><th /></tr></thead>
              <tbody>
                {equipe.map((m) => (
                  <tr key={m.id} className={m.ativo ? undefined : 'muted'}>
                    <td><b>{m.nome}</b><br /><span className="small muted">{m.email}</span></td>
                    <td>{PAPEIS[m.papel]}</td>
                    <td>{m.ativo ? 'Ativo' : 'Desativado'}<br /><span className="small muted">desde {dataHora(m.criado_em)}</span></td>
                    <td>
                      {m.id === user.id ? <span className="small muted">Você</span> : (
                        <form action={alterarAcesso} className="inline">
                          <input type="hidden" name="perfilId" value={m.id} />
                          <button className="btn small" type="submit" name="ativo" value={m.ativo ? 'nao' : 'sim'}>{m.ativo ? 'Desativar' : 'Reativar'}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="small muted">Nenhuma pessoa na equipe.</p>}
          <p className="small muted">Quem é desativado perde o acesso na próxima página que abrir. O histórico do que a pessoa fez continua guardado.</p>
        </div>

        <div className="stack">
          <form action={salvarMembroEquipe} className="panel stack">
            <p className="label">Incluir ou mudar perfil</p>
            <p className="small">A pessoa precisa entrar uma vez em <b>Entrar</b> com o próprio e-mail. Depois disso, defina o perfil aqui.</p>
            <label className="f">E-mail<input name="email" type="email" required autoComplete="off" /></label>
            <label className="f">Nome<input name="nome" required maxLength={120} /></label>
            <label className="f">Perfil
              <select name="papel" defaultValue="atendente">
                <option value="atendente">Atendente</option>
                <option value="especialista">Especialista</option>
                <option value="admin">Administrador</option>
                <option value="cliente">Tirar da equipe (volta a ser cliente)</option>
              </select>
            </label>
            <div><button className="btn primary" type="submit">Salvar perfil</button></div>
          </form>
          <div className="panel stack">
            <p className="label">O que cada perfil faz</p>
            {(Object.keys(O_QUE_FAZ) as Papel[]).map((p) => <p key={p} className="small"><b>{PAPEIS[p]}:</b> {O_QUE_FAZ[p]}</p>)}
            <p className="small muted">A oficina sempre mantém pelo menos um administrador ativo, e ninguém altera o próprio perfil.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
