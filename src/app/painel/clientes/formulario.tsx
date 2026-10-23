'use client';
import { useActionState } from 'react';
import { cadastrarClienteEquipe } from '../actions';
import { CANAIS_EQUIPE } from '@/lib/validacao';

export function ClienteEquipeForm() {
  const [estado, enviar, pendente] = useActionState(cadastrarClienteEquipe, null);
  return (
    <form action={enviar} className="panel stack" noValidate>
      <div className="grid2">
        <label className="f">Nome completo<input name="nome" autoComplete="off" required /></label>
        <label className="f">Telefone com DDD<input name="telefone" inputMode="tel" placeholder="(13) 91234-5678" required /></label>
      </div>
      <div className="grid2">
        <label className="f">E-mail (opcional)<input name="email" type="email" autoComplete="off" /></label>
        <label className="f">Prefere contato por
          <select name="preferencia" defaultValue="whatsapp"><option value="whatsapp">WhatsApp</option><option value="telefone">Ligação</option><option value="email">E-mail</option></select>
        </label>
      </div>
      <div className="grid2">
        <label className="f">Chegou por
          <select name="canal" defaultValue="balcao">{Object.entries(CANAIS_EQUIPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="f">Como conheceu a oficina
          <select name="origem" defaultValue="indicacao">
            <option value="instagram">Instagram</option><option value="anuncio">Anúncio</option><option value="google">Google</option>
            <option value="indicacao">Indicação</option><option value="whatsapp">WhatsApp</option><option value="site">Site</option><option value="outro">Outro</option>
          </select>
        </label>
      </div>
      <label className="check"><input type="checkbox" name="cientePrivacidade" /> <span>Informei o cliente sobre o aviso de privacidade (uso dos dados só para o atendimento da moto).</span></label>
      <label className="check"><input type="checkbox" name="aceiteLembretes" /> <span>Cliente aceita lembretes de manutenção</span></label>
      <label className="check"><input type="checkbox" name="aceiteMarketing" /> <span>Cliente aceita novidades e promoções</span></label>
      <p className="small muted">Marque os aceites só se o cliente disse sim. Se ele informar o mesmo e-mail ao entrar no site, o cadastro se liga ao login automaticamente.</p>
      {estado && !estado.ok && <p className="err" role="alert">{estado.erro}</p>}
      <div><button className="btn primary" type="submit" disabled={pendente}>{pendente ? 'Salvando…' : 'Cadastrar cliente'}</button></div>
    </form>
  );
}
