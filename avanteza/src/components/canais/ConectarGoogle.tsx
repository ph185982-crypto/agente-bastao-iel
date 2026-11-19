"use client";
// Seção “Google · Perfil da Empresa” (só administradores): fonte (Windsor.ai), nome do local, testar conexão e salvar. Sem campo de chave:
// usa a MESMA chave do Instagram (chave do canal, salva na seção do Instagram, ou WINDSOR_API_KEY da plataforma).
import { useActionState, useState } from "react";
import { salvarGoogleCanal, testarConexaoGoogleAcao, type EstadoTesteGoogle } from "@/app/(painel)/clientes/canais-actions";
import { Botao } from "./ConectarMeta";

export function ConectarGoogle({ clientId, inicial }: { clientId: string; inicial: { gbpSource: "windsor" | "none"; local: string } }) {
  const [v, setV] = useState(inicial);
  const [estado, testar] = useActionState<EstadoTesteGoogle, FormData>(testarConexaoGoogleAcao, null);
  const r = estado?.resultado;
  return (
    <form action={salvarGoogleCanal} className="card stack" autoComplete="off" style={{ marginTop: 12 }} aria-label="Configurar Google · Perfil da Empresa">
      <h3>Configurar Google · Perfil da Empresa</h3>
      <p className="small muted" style={{ margin: 0 }}>Somente leitura, pelo Windsor.ai (conector Google My Business). Fonte <b>independente</b>: tem teste, coleta e erro próprios e nunca mexe nos anúncios nem no Instagram.</p>
      <input type="hidden" name="client_id" value={clientId} />
      <div className="grid two">
        <div className="field">
          <label htmlFor="cg-fonte">Fonte do Google</label>
          <select id="cg-fonte" name="gbp_source" value={v.gbpSource} onChange={(e) => setV((x) => ({ ...x, gbpSource: e.target.value === "none" ? "none" : "windsor" }))}>
            <option value="windsor">Windsor.ai (Perfil da Empresa)</option>
            <option value="none">Sem Google</option>
          </select>
        </div>
        {v.gbpSource === "windsor" && (
          <div className="field">
            <label htmlFor="cg-local">Nome do local no Windsor.ai</label>
            <input id="cg-local" name="gbp_location_name" value={v.local} onChange={(e) => setV((x) => ({ ...x, local: e.target.value }))} placeholder="SHOW MAN BARBEARIA" spellCheck={false} />
            <div className="small muted" style={{ marginTop: 4 }}>Opcional com um só local. Com mais de um, é obrigatório (não mistura dados).</div>
          </div>
        )}
      </div>
      <p className="small muted" style={{ margin: 0 }}>Chave: a mesma do Instagram (do canal ou WINDSOR_API_KEY). Nenhuma chave é digitada ou mostrada aqui.</p>
      <div className="btn-row">
        {v.gbpSource === "windsor" && <Botao className="btn btn-ghost" formAction={testar}>Testar conexão (Google)</Botao>}
        <Botao className="btn btn-orange">Salvar Google</Botao>
      </div>
      {estado?.erro && <div className="notice danger" role="alert">{estado.erro}</div>}
      {r && (
        <div className={`notice ${r.ok ? "ok" : "danger"}`} role="status" aria-live="polite">
          <strong>{r.ok ? "Perfil da Empresa respondendo" : "Há pendências na conexão com o Google"}</strong>
          <div className="small muted">Chave usada: {r.origemChave === "canal" ? "do canal" : r.origemChave === "plataforma" ? "da plataforma (WINDSOR_API_KEY)" : "nenhuma"}</div>
          <ul className="list" style={{ marginTop: 8 }}>
            {r.verificacoes.map((x) => (
              <li key={x.id}>
                <div className="row"><strong>{x.rotulo}</strong><span className={`pill ${x.ok === true ? "pill-ok" : x.ok === false ? "pill-danger" : "pill-outline"}`}>{x.ok === true ? "OK" : x.ok === false ? "Falhou" : "Aviso"}</span></div>
                <div className="small" style={{ overflowWrap: "anywhere" }}>{x.detalhe}</div>
              </li>
            ))}
          </ul>
          {r.info.locais.length === 1 && v.local.trim() === "" && <p className="small" style={{ margin: "8px 0 0" }}>Local encontrado: <b>{r.info.locais[0]}</b> — copie para “Nome do local” se quiser fixá-lo.</p>}
        </div>
      )}
    </form>
  );
}
