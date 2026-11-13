"use client";
import { useState } from "react";
import { proposeManual } from "@/app/actions";
import { Submit } from "./Submit";

const TYPES: [string, string][] = [
  ["update_price", "Alterar preço"],
  ["update_stock", "Alterar estoque"],
  ["pause_listing", "Pausar anúncio"],
  ["activate_listing", "Reativar anúncio"],
  ["update_listing", "Editar título/descrição"],
  ["answer_question", "Responder pergunta"],
  ["update_ads_budget", "Alterar verba de campanha"],
  ["update_ads_status", "Ligar/pausar campanha"],
  ["create_promotion", "Criar promoção (desconto)"],
];

export function ProposeForm({
  clientId,
  accounts,
  defaults,
}: {
  clientId: string;
  accounts: { id: string; nickname: string | null }[];
  defaults?: { type?: string; target?: string; accountId?: string };
}) {
  const [type, setType] = useState(defaults?.type ?? "update_price");
  const targetLabel =
    type === "answer_question" ? "ID da pergunta" : type.startsWith("update_ads") ? "ID da campanha" : "ID do anúncio (MLB…)";
  return (
    <form action={proposeManual} className="stack">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="back" value={`/clientes/${clientId}#acoes`} />
      <div className="grid two">
        <div className="field">
          <label htmlFor="pf-acc">Conta</label>
          <select id="pf-acc" name="account_id" defaultValue={defaults?.accountId}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.nickname ?? a.id}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pf-type">Ação</label>
          <select id="pf-type" name="action_type" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="pf-target">{targetLabel}</label>
        <input id="pf-target" name="target_id" required defaultValue={defaults?.target} />
      </div>
      {type === "update_price" && <div className="field"><label>Novo preço (R$)</label><input name="price" inputMode="decimal" required /></div>}
      {type === "update_stock" && <div className="field"><label>Novo estoque</label><input name="available_quantity" inputMode="numeric" required /></div>}
      {type === "update_listing" && (
        <>
          <div className="field"><label>Novo título (até 60 caracteres)</label><input name="title" maxLength={60} /></div>
          <div className="field"><label>Nova descrição (texto simples)</label><textarea name="description" /></div>
        </>
      )}
      {type === "answer_question" && <div className="field"><label>Resposta</label><textarea name="text" required maxLength={2000} /></div>}
      {type === "update_ads_budget" && <div className="field"><label>Nova verba diária (R$)</label><input name="budget" inputMode="decimal" required /></div>}
      {type === "update_ads_status" && (
        <div className="field"><label>Status</label><select name="status"><option value="active">Ativar</option><option value="paused">Pausar</option></select></div>
      )}
      {type === "create_promotion" && (
        <div className="grid two">
          <div className="field"><label>Preço promocional (R$)</label><input name="deal_price" inputMode="decimal" required /></div>
          <div className="field"><label>Início</label><input type="datetime-local" name="start_date" required /></div>
          <div className="field"><label>Fim</label><input type="datetime-local" name="finish_date" required /></div>
        </div>
      )}
      <div className="field"><label>Justificativa</label><input name="reason" placeholder="Por que esta ação?" /></div>
      <label className="check"><input type="checkbox" name="dry_run" /> Apenas simular (não altera nada no marketplace)</label>
      <Submit className="btn">Enviar para a fila</Submit>
    </form>
  );
}
