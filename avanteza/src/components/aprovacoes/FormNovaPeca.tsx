// Formulário "Enviar peça para aprovação" (Operações → Aprovações e ficha do cliente). Precisa do cliente escolhido para listar
// as tarefas que podem ser ligadas (aprovar conclui a tarefa) e os arquivos do cliente.
import { Submit } from "@/components/Submit";
import { criarAprovacaoForm } from "@/app/(equipe)/operacoes/aprovacoes/actions";
import { ROTULO_TIPO_PECA, TIPOS_PECA } from "@/lib/aprovacoes/tipos";
import { fmtDate } from "@/lib/mapa/progress";

export function FormNovaPeca({ clientId, tarefas, arquivos, back }: {
  clientId: string; tarefas: { id: string; title: string; due_date: string | null }[]; arquivos: { id: string; title: string }[]; back: string;
}) {
  return (
    <form action={criarAprovacaoForm} className="ap-form" aria-label="Enviar peça para aprovação">
      <input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="back" value={back} />
      <div className="field"><label htmlFor="np-tipo">Tipo</label>
        <select id="np-tipo" name="tipo" defaultValue="criativo">{TIPOS_PECA.map((t) => <option key={t} value={t}>{ROTULO_TIPO_PECA[t]}</option>)}</select>
      </div>
      <div className="field"><label htmlFor="np-tit">Título</label><input id="np-tit" name="titulo" required minLength={3} maxLength={200} placeholder="Ex.: Post Black Friday — carrossel" /></div>
      <div className="field"><label htmlFor="np-prazo">Prazo para o cliente</label><input id="np-prazo" name="prazo" type="date" /></div>
      <div className="field"><label htmlFor="np-link">Link da peça</label><input id="np-link" name="link" type="url" maxLength={2000} placeholder="https://drive.google.com/…" /></div>
      <div className="field"><label htmlFor="np-arq">ou arquivo do cliente</label>
        <select id="np-arq" name="arquivo_id" defaultValue=""><option value="">— nenhum —</option>{arquivos.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select>
      </div>
      <div className="field"><label htmlFor="np-acao">Tarefa ligada (aprovar conclui)</label>
        <select id="np-acao" name="action_id" defaultValue=""><option value="">— nenhuma —</option>{tarefas.map((t) => <option key={t.id} value={t.id}>{t.title}{t.due_date ? ` (${fmtDate(t.due_date)})` : ""}</option>)}</select>
      </div>
      <div className="field full"><label htmlFor="np-desc">O que o cliente deve conferir (opcional)</label><textarea id="np-desc" name="descricao" maxLength={2000} style={{ minHeight: 70 }} /></div>
      <div className="full"><Submit className="btn btn-orange">Enviar para aprovação</Submit></div>
    </form>
  );
}
