// Página pública exibida ao CLIENTE depois de autorizar no Mercado Livre.
import { Logo } from "@/components/Logo";

export default async function Conectado({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ok = sp.status === "ok";
  return (
    <div className="login-wrap">
      <div className="login-box" style={{ textAlign: "center" }}>
        <Logo sub size={36} />
        <div className="card" style={{ marginTop: 24, textAlign: "left" }}>
          <h1 style={{ fontSize: 22 }}>{ok ? <>Conta <span className="serif">conectada</span></> : "Não foi possível conectar"}</h1>
          <p style={{ marginTop: 8 }}>
            {ok
              ? `A conta ${sp.detalhe ?? ""} do Mercado Livre foi autorizada com sucesso. A equipe Avanteza já pode acompanhar seus indicadores. Você pode fechar esta página.`
              : sp.detalhe ?? "Tente novamente com um novo link."}
          </p>
        </div>
      </div>
    </div>
  );
}
