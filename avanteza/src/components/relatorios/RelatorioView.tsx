// Relatório semanal na tela (Mapa do cliente e revisão da equipe): abertura, destaques, números e listas. Mesmos dados do PDF.
import { fmtDate } from "@/lib/mapa/progress";
import { fmtVariacao, kpisDoRelatorio, type DadosRelatorio, type ItemRelatorio } from "@/lib/relatorios/semana";
import "@/components/aprovacoes/aprovacoes.css";

function Lista({ titulo, itens, vazio }: { titulo: string; itens: ItemRelatorio[]; vazio: string }) {
  return (
    <section className="card" aria-label={titulo}>
      <h3>{titulo} <span className="pill pill-outline">{itens.length}</span></h3>
      {itens.length === 0 ? <p className="small muted" style={{ margin: 0 }}>{vazio}</p> : (
        <ul className="list">
          {itens.map((i, k) => (
            <li key={k}>
              {i.titulo}
              <div className="small muted">{i.data ? fmtDate(i.data) : "sem prazo"}{i.detalhe ? ` · ${i.detalhe}` : ""}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RelatorioView({ dados, abertura, destaques }: { dados: DadosRelatorio; abertura: string; destaques: string[] }) {
  const kpis = kpisDoRelatorio(dados);
  return (
    <>
      <div className="card" style={{ marginTop: 14 }}>
        <p className="rs-abertura">{abertura}</p>
        {destaques.length > 0 && (
          <>
            <h3 style={{ margin: "16px 0 0" }}>Destaques da semana</h3>
            <ul className="rs-destaques">{destaques.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </>
        )}
      </div>
      {kpis.length > 0 && (
        <>
          <h2>Números da semana</h2>
          {(["Marketplaces", "Anúncios (Meta)", "Instagram"] as const).map((g) => {
            const ks = kpis.filter((k) => k.grupo === g);
            if (!ks.length) return null;
            return (
              <div key={g}>
                <div className="rs-grupo">{g}</div>
                <div className="rs-kpis">
                  {ks.map((k) => (
                    <div className="kpi" key={k.rotulo}>
                      <div className="label">{k.rotulo}</div>
                      <div className="value">{k.valor}</div>
                      {k.variacao !== null && <div className={`delta ${k.variacao < 0 ? "down" : "up"}`}>{fmtVariacao(k.variacao)}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
      <div className="rs-listas">
        <Lista titulo="Entregas concluídas" itens={dados.entregas} vazio="Nenhuma entrega concluída nesta semana." />
        <Lista titulo="O que vem" itens={dados.proximas} vazio="Nada agendado para os próximos 7 dias." />
        <Lista titulo="Depende de você" itens={dados.dependeDoCliente} vazio="Nada parado esperando por você." />
      </div>
    </>
  );
}
