"use client";
import { useState, useTransition } from "react";
import { generateAuthLink } from "@/app/actions";
import { CopyButton } from "./CopyButton";

const LABEL: Record<string, string> = { mercadolivre: "Mercado Livre", shopee: "Shopee" };

export function AuthLinkBox({ clientId, clientName, marketplaces = ["mercadolivre"] }: { clientId: string; clientName: string; marketplaces?: string[] }) {
  const [mk, setMk] = useState("mercadolivre");
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const msg = url
    ? `Olá! Para a Avanteza acompanhar sua conta ${mk === "shopee" ? "da Shopee" : "do Mercado Livre"}, autorize o acesso por este link (válido por 7 dias, uso único): ${url}`
    : "";
  return (
    <div className="stack">
      {marketplaces.length > 1 && (
        <select value={mk} onChange={(e) => { setMk(e.target.value); setUrl(null); }} style={{ maxWidth: 240 }} aria-label="Marketplace">
          {marketplaces.map((m) => <option key={m} value={m}>{LABEL[m] ?? m}</option>)}
        </select>
      )}
      <button
        className="btn btn-orange"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await generateAuthLink(clientId, mk);
            if (r.url) setUrl(r.url);
            else setErr(r.error ?? "Erro ao gerar link");
          })
        }
      >
        {pending ? "Gerando…" : "Gerar link de autorização"}
      </button>
      {err && <div className="notice danger small">{err}</div>}
      {url && (
        <div className="notice">
          <div className="small muted">Link para {clientName} ({LABEL[mk]} · válido por 7 dias · uso único)</div>
          <div className="mono" style={{ margin: "6px 0 10px" }}>{url}</div>
          <div className="btn-row">
            <CopyButton text={url} label="Copiar link" />
            <CopyButton text={msg} label="Copiar mensagem" />
            <a className="btn btn-sm btn-ghost" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">
              Enviar no WhatsApp
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
