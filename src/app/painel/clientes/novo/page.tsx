import Link from 'next/link';
import { equipeAtual } from '@/lib/equipe';
import { NavPainel } from '../../navegacao';
import { ClienteEquipeForm } from '../formulario';

export const metadata = { title: 'Novo cliente · Painel' };

export default async function NovoCliente() {
  const { nome, admin } = await equipeAtual();
  return (
    <div className="wrap page">
      <NavPainel atual="clientes" nome={nome} admin={admin} />
      <p className="label"><Link href="/painel/clientes">Clientes</Link></p>
      <h2 style={{ margin: '8px 0 12px' }}>Novo cliente</h2>
      <div style={{ maxWidth: 760 }}><ClienteEquipeForm /></div>
    </div>
  );
}
