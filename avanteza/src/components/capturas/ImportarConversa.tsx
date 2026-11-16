"use client";
// Importar conversa exportada do WhatsApp: escolher o arquivo → prévia (participantes, período, cliente lembrado) →
// escolher/confirmar o cliente → importar (só as mensagens novas; combinados viram ações com selo IA).
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { capturaAction, type EstadoImportacao } from "@/app/(equipe)/operacoes/capturas/actions";

const LIMITE = 4 * 1024 * 1024;
const dataBR = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export function ImportarConversa({ clientes, podeImportar }: { clientes: { id: string; name: string }[]; podeImportar: boolean }) {
  const [estado, despachar] = useActionState<EstadoImportacao, FormData>(capturaAction, { etapa: "inicio" });
  const [pendente, iniciar] = useTransition();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [cliente, setCliente] = useState("");
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const enviar = (passo: "previa" | "importar" | "reiniciar", clienteId = cliente) => {
    setErroLocal(null);
    const fd = new FormData();
    fd.set("passo", passo);
    if (passo !== "reiniciar") {
      if (!arquivo) { setErroLocal("Escolha o arquivo .txt ou .zip."); return; }
      if (arquivo.size > LIMITE) { setErroLocal("Arquivo acima de 4 MB: exporte a conversa “sem mídia”."); return; }
      fd.set("arquivo", arquivo);
      fd.set("cliente", clienteId);
      fd.set("cliente_nome", clientes.find((c) => c.id === clienteId)?.name ?? "");
    }
    iniciar(() => despachar(fd));
  };

  const previa = estado.etapa === "previa" ? estado.previa : null;
  // cliente lembrado para esta conversa entra já escolhido
  const sugerido = previa?.clienteSugerido?.id;
  useEffect(() => { if (sugerido) setCliente((c) => c || sugerido); }, [sugerido]);
  const erro = erroLocal ?? (estado.etapa !== "feito" ? estado.erro : undefined);

  if (estado.etapa === "feito") {
    const r = estado.resultado;
    return (
      <div className="cp-box stack" role="status">
        <h3 style={{ margin: 0 }}>Conversa importada{estado.cliente ? ` para ${estado.cliente}` : ""}</h3>
        <ul className="cp-num">
          <li><strong>{r.novas}</strong> mensagem(ns) nova(s)</li>
          <li><strong>{r.duplicadas}</strong> já importada(s) antes</li>
          <li><strong>{r.blocos}</strong> bloco(s) de dias analisado(s)</li>
          <li><strong>{r.acoesCriadas}</strong> ação(ões) criada(s) pela IA</li>
          {r.audiosTranscritos + r.audiosNaoTranscritos > 0 && <li><strong>{r.audiosTranscritos}</strong> áudio(s) transcrito(s), <strong>{r.audiosNaoTranscritos}</strong> não transcrito(s)</li>}
        </ul>
        {r.semIa && <p className="small muted">IA não configurada: as mensagens ficaram registradas, sem extrair ações.</p>}
        {r.erros.length > 0 && <p className="small" role="alert">Falhas na análise: {r.erros.join(" · ")}</p>}
        <div className="btn-row">
          <Link className="btn btn-sm btn-orange" href={`/operacoes/capturas?cliente=${r.clientId}`}>Ver capturas do cliente</Link>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setArquivo(null); setCliente(""); if (input.current) input.current.value = ""; enviar("reiniciar"); }}>Importar outra</button>
        </div>
      </div>
    );
  }

  return (
    <form className="cp-box stack" onSubmit={(e) => { e.preventDefault(); enviar(previa ? "importar" : "previa"); }}>
      <div className="field">
        <label htmlFor="cp-arquivo">Arquivo exportado (.txt ou .zip, até 4 MB)</label>
        <input
          id="cp-arquivo" ref={input} type="file" accept=".txt,.zip,text/plain,application/zip" disabled={!podeImportar}
          onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); setCliente(""); if (previa) enviar("reiniciar"); }}
        />
        <p className="small muted" style={{ margin: "6px 0 0" }}>No WhatsApp: abra a conversa ou o grupo → ⋮ / nome do contato → Mais → Exportar conversa.</p>
      </div>

      {previa && (
        <div className="cp-previa stack">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <strong>{previa.titulo ?? "Conversa sem título"}</strong>
              <div className="small muted">
                {previa.grupo ? "Grupo" : "Individual"} · {previa.formato === "ios" ? "iPhone" : previa.formato === "android" ? "Android" : "formato não identificado"} ·{" "}
                {previa.mensagens} mensagem(ns) de {dataBR(previa.de)} a {dataBR(previa.ate)}
                {previa.midias ? ` · ${previa.midias} mídia(s)` : ""}{previa.audios ? ` · ${previa.audios} áudio(s)` : ""}
              </div>
              {previa.participantes.length > 0 && <div className="small muted">Participantes: {previa.participantes.join(", ")}</div>}
            </div>
            {previa.jaImportadas != null && previa.jaImportadas > 0 && <span className="pill pill-outline">{previa.jaImportadas} já importada(s)</span>}
          </div>
          <ol className="cp-amostra" aria-label="Últimas mensagens">
            {previa.amostra.map((m, i) => (
              <li key={i}><span className="small muted">{m.quando}</span> <strong>{m.autor}</strong>: {m.texto}</li>
            ))}
          </ol>
          <div className="field">
            <label htmlFor="cp-cliente">Cliente desta conversa{previa.clienteSugerido ? " (lembrado da última importação)" : ""}</label>
            <select id="cp-cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} required>
              <option value="">Escolha o cliente…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {erro && <p className="notice danger" role="alert" style={{ margin: 0 }}>{erro}</p>}
      <div className="btn-row">
        <button className="btn btn-sm btn-orange" type="submit" disabled={pendente || !podeImportar || !arquivo || (Boolean(previa) && !cliente)}>
          {pendente ? (previa ? "Importando…" : "Lendo…") : previa ? "Importar conversa" : "Ver prévia"}
        </button>
        {previa && <button type="button" className="btn btn-sm btn-ghost" disabled={pendente} onClick={() => { setArquivo(null); setCliente(""); if (input.current) input.current.value = ""; enviar("reiniciar"); }}>Cancelar</button>}
      </div>
    </form>
  );
}
