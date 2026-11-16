"use client";
// Quadro kanban do Funil de Entrega. Por etapa (padrão) ou por pilar. Arrastar o cartão (mouse) ou usar as setas (toque/teclado)
// muda a etapa — ou o pilar, na visão por pilar. A tela atualiza na hora e desfaz se o CRM recusar. Só administrador move.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { moverNoQuadro } from "@/app/(equipe)/operacoes/entregas/actions";
import { ROTULO_COLUNA, ROTULO_PILAR, type CartaoQuadro, type Coluna, type Pilar } from "@/lib/entregas/crm";
import { fmtDiaCurto } from "@/lib/entregas/forms";

export interface ClienteDoCartao { cliente: string; entrega: string }
interface Props {
  colunas: Array<{ id: string; rotulo: string }>;
  por: "etapa" | "pilar";
  cartoes: CartaoQuadro[];
  entregas: Record<string, ClienteDoCartao>;
  podeEscrever: boolean;
}

const iniciais = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

export function Quadro({ colunas, por, cartoes, entregas, podeEscrever }: Props) {
  const router = useRouter();
  const [lista, setLista] = useState(cartoes);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const [, iniciar] = useTransition();
  useEffect(() => setLista(cartoes), [cartoes]);

  const campo = por === "etapa" ? "coluna" : "pilar";
  const rotulo = (id: string) => colunas.find((c) => c.id === id)?.rotulo ?? id;

  function mover(c: CartaoQuadro, para: string) {
    if (!podeEscrever || c[campo] === para) return;
    const anterior = lista;
    setMsg(null);
    setLista((l) => l.map((x) => (x.id === c.id ? { ...x, [campo]: para, ...(campo === "coluna" ? { ordem: 9999, diasNaColuna: 0, diasDeAtraso: para === "CONCLUIDO" ? 0 : x.diasDeAtraso } : {}) } : x)));
    iniciar(async () => {
      const r = await moverNoQuadro(c.entregaId, c.id, campo === "coluna" ? { coluna: para } : { pilar: para });
      if (r.ok) { setMsg({ tipo: "ok", texto: `Movido para "${rotulo(para)}".` }); router.refresh(); }
      else { setLista(anterior); setMsg({ tipo: "erro", texto: r.erro }); }
    });
  }

  return (
    <div className="ent-board-wrap">
      <div className="ent-board" role="list" aria-label={por === "etapa" ? "Etapas" : "Pilares"}>
        {colunas.map((col, ci) => {
          const itens = lista.filter((c) => c[campo] === col.id).sort((a, b) => a.ordem - b.ordem);
          return (
            <section
              key={col.id} role="listitem" aria-label={`${col.rotulo}, ${itens.length} cartões`}
              className={`ent-col ${alvo === col.id ? "alvo" : ""}`}
              onDragOver={podeEscrever ? (e) => { e.preventDefault(); setAlvo(col.id); } : undefined}
              onDragLeave={podeEscrever ? () => setAlvo((a) => (a === col.id ? null : a)) : undefined}
              onDrop={podeEscrever ? (e) => { e.preventDefault(); setAlvo(null); const c = lista.find((x) => x.id === (arrastando ?? e.dataTransfer.getData("text/plain"))); setArrastando(null); if (c) mover(c, col.id); } : undefined}
            >
              <div className="ent-col-h"><h3>{col.rotulo}</h3><span className="n">{itens.length}</span></div>
              <div className="ent-col-corpo">
                {itens.length === 0 && <div className="ent-vazio">{podeEscrever ? "Solte um cartão aqui" : "Nenhum cartão"}</div>}
                {itens.map((c) => {
                  const e = entregas[c.entregaId];
                  const atrasado = c.diasDeAtraso > 0 && c.coluna !== "CONCLUIDO";
                  return (
                    <article
                      key={c.id} draggable={podeEscrever}
                      className={`ent-card ${atrasado ? "atrasado" : ""} ${podeEscrever ? "" : "somente"} ${arrastando === c.id ? "arrastando" : ""}`}
                      onDragStart={(ev) => { setArrastando(c.id); ev.dataTransfer.setData("text/plain", c.id); ev.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setArrastando(null); setAlvo(null); }}
                    >
                      <Link href={`/operacoes/entregas/${encodeURIComponent(c.entregaId)}/${encodeURIComponent(c.id)}`} className="ent-card-link" draggable={false}>
                        <div className="tit">{c.titulo}</div>
                        <div className="cli">{e?.cliente ?? "Cliente"}</div>
                        <div className="tags">
                          <span className="pill pill-outline">{por === "etapa" ? ROTULO_PILAR[c.pilar as Pilar] ?? c.pilar : ROTULO_COLUNA[c.coluna as Coluna] ?? c.coluna}</span>
                          {c.cliente && <span className="pill pill-sand">Do cliente</span>}
                          {c.checklist.total > 0 && <span className="pill pill-navy">{c.checklist.feitos}/{c.checklist.total}</span>}
                          {c.coluna === "AGUARDANDO_CLIENTE" && c.diasNaColuna > 0 && <span className="pill pill-navy">há {c.diasNaColuna} d</span>}
                        </div>
                      </Link>
                      <div className="rodape">
                        <span className="quem">
                          {c.responsavel ? <><b aria-hidden="true">{iniciais(c.responsavel.nome)}</b><span>{c.responsavel.nome}</span></> : <span>Sem responsável</span>}
                        </span>
                        <span className={atrasado ? "atraso" : ""}>{atrasado ? `atrasado ${c.diasDeAtraso} d` : c.dataAlvo ? fmtDiaCurto(c.dataAlvo) : ""}</span>
                      </div>
                      {podeEscrever && (
                        <div className="rodape" style={{ justifyContent: "flex-end" }}>
                          <span className="ent-mover" role="group" aria-label="Mover cartão">
                            <button type="button" disabled={ci === 0} onClick={() => mover(c, colunas[ci - 1].id)} aria-label={`Mover para ${colunas[ci - 1]?.rotulo ?? ""}`}>‹</button>
                            <button type="button" disabled={ci === colunas.length - 1} onClick={() => mover(c, colunas[ci + 1].id)} aria-label={`Mover para ${colunas[ci + 1]?.rotulo ?? ""}`}>›</button>
                          </span>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="ent-aviso" aria-live="polite">
        {msg && <div className={`notice ${msg.tipo === "erro" ? "danger" : "ok"}`} role="status">{msg.texto}</div>}
        {!podeEscrever && <p className="small muted" style={{ margin: "6px 0 0" }}>Somente leitura: só administradores movem cartões.</p>}
      </div>
    </div>
  );
}
