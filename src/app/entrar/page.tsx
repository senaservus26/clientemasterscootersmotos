'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseNavegador } from '@/lib/supabase/client';

// Acesso sem senha: código de 6 dígitos enviado por e-mail.
export default function Entrar() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [etapa, setEtapa] = useState<'email' | 'codigo'>('email');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviarCodigo(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setErro('Informe um e-mail válido.');
    setEnviando(true);
    const { error } = await supabaseNavegador().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setEnviando(false);
    if (error) return setErro('Não foi possível enviar o código agora. Tente de novo em alguns minutos.');
    setEtapa('codigo');
  }

  async function confirmarCodigo(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    const { error } = await supabaseNavegador().auth.verifyOtp({ email: email.trim(), token: codigo.trim(), type: 'email' });
    setEnviando(false);
    if (error) return setErro('Código incorreto ou expirado. Confira o e-mail ou peça um novo código.');
    router.replace('/cliente');
    router.refresh();
  }

  return (
    <div className="wrap page" style={{ maxWidth: 520 }}>
      <p className="label">Área do cliente</p>
      <h2>Entrar</h2>
      {etapa === 'email' ? (
        <form className="panel stack" onSubmit={enviarCodigo} noValidate style={{ marginTop: 16 }}>
          <p className="small muted">Enviaremos um código de 6 dígitos para o seu e-mail. Não é preciso criar senha.</p>
          <label className="f">E-mail<input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {erro && <p className="err" role="alert">{erro}</p>}
          <button className="btn primary" type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Receber código'}</button>
        </form>
      ) : (
        <form className="panel stack" onSubmit={confirmarCodigo} noValidate style={{ marginTop: 16 }}>
          <p className="small">Enviamos o código para <b>{email}</b>.</p>
          <label className="f">Código de acesso<input id="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} /></label>
          {erro && <p className="err" role="alert">{erro}</p>}
          <button className="btn primary" type="submit" disabled={enviando || codigo.length !== 6}>{enviando ? 'Conferindo…' : 'Entrar'}</button>
          <button className="btn small" type="button" onClick={() => { setEtapa('email'); setCodigo(''); }}>Usar outro e-mail</button>
        </form>
      )}
    </div>
  );
}
