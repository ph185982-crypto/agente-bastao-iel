// Filtros do quadro e da lista de clientes: formulário GET (funciona sem JavaScript e deixa o link compartilhável).
import Link from "next/link";
import { PILARES, ROTULO_PILAR, ROTULO_STATUS, STATUS_ENTREGA, type Pessoa } from "@/lib/entregas/crm";
import { hrefEntregas, type FiltrosUrl } from "./Cabecalho";

export function Filtros({ f, usuarios }: { f: FiltrosUrl; usuarios: Pessoa[] }) {
  const ativo = Boolean(f.q || f.resp || f.pilar || f.atraso || f.status !== "EM_ANDAMENTO");
  return (
    <form className="ent-filtros" method="get" action="/operacoes/entregas" role="search" aria-label="Filtros">
      {f.aba !== "quadro" && <input type="hidden" name="aba" value={f.aba} />}
      {f.por !== "etapa" && <input type="hidden" name="por" value={f.por} />}
      <div className="field"><label htmlFor="ent-q">Cliente</label><input id="ent-q" name="q" defaultValue={f.q} placeholder="Nome do cliente" maxLength={100} /></div>
      <div className="field"><label htmlFor="ent-resp">Responsável</label>
        <select id="ent-resp" name="resp" defaultValue={f.resp}>
          <option value="">Todos</option><option value="sem">Sem responsável</option>
          {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select></div>
      <div className="field"><label htmlFor="ent-pilar">Pilar</label>
        <select id="ent-pilar" name="pilar" defaultValue={f.pilar}>
          <option value="">Todos</option>{PILARES.map((p) => <option key={p} value={p}>{ROTULO_PILAR[p]}</option>)}
        </select></div>
      <div className="field"><label htmlFor="ent-status">Entrega</label>
        <select id="ent-status" name="status" defaultValue={f.status}>
          {STATUS_ENTREGA.map((s) => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}
        </select></div>
      <label className="check small"><input type="checkbox" name="atraso" value="1" defaultChecked={f.atraso} /> Só atrasados</label>
      <div className="ent-filtros-btns">
        <button className="btn btn-sm" type="submit">Filtrar</button>
        {ativo && <Link className="btn btn-ghost btn-sm" href={hrefEntregas({ aba: f.aba, por: f.por })}>Limpar</Link>}
      </div>
    </form>
  );
}
