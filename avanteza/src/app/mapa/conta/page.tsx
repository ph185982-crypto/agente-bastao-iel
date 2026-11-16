import { requireMapa } from "@/lib/mapa/auth";
import { getClient, listCompanies } from "@/lib/mapa/repo";
import { avantezaContact } from "@/lib/mapa/contact";
import { fmtDate } from "@/lib/mapa/progress";
import { PasswordForm } from "@/components/mapa/PasswordForm";

const KIND = { marketplace: "Marketplaces", midia: "Tráfego e mídias", ambos: "Marketplaces e mídias" } as const;

export default async function Conta() {
  const { scope, session } = await requireMapa();
  const [client, companies] = await Promise.all([getClient(scope), listCompanies(scope)]);
  if (!client) return null;
  const c = avantezaContact();
  const row = (k: string, v: string | null) => <li><div className="small muted">{k}</div><div>{v || "—"}</div></li>;
  return (
    <>
      <div className="eyebrow">Minha conta</div>
      <h1>Conta</h1>

      <h2>Fale com a Avanteza</h2>
      <div className="contact-box">
        <div className="lbl">Seu contato</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{c.name}</div>
        <div className="grid two" style={{ marginTop: 12 }}>
          <div><div className="lbl">E-mail</div>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span>Fale pelo WhatsApp</span>}</div>
          <div><div className="lbl">WhatsApp</div>{c.whatsapp ? <a href={c.whatsappUrl ?? "#"} target="_blank" rel="noreferrer">{c.whatsapp}</a> : <span>Peça ao seu consultor</span>}</div>
        </div>
      </div>

      <h2>Dados da empresa</h2>
      <div className="card">
        <ul className="list">
          {row("Empresa", client.name)}
          {row("Serviço contratado", KIND[client.kind])}
          {row("Início do plano", client.start_date ? fmtDate(client.start_date) : null)}
          {row("Contato na empresa", client.contact_name)}
          {row("E-mail", client.contact_email)}
          {row("Telefone", client.contact_phone)}
          {companies.length > 1 && row("Empresas do seu grupo", companies.map((x) => x.name).join(", "))}
        </ul>
      </div>

      <h2>Acesso</h2>
      <div className="card"><div className="small muted">Você entra com</div><strong>{session.email}</strong></div>
      <div style={{ marginTop: 12 }}><PasswordForm disabled={scope.readOnly} /></div>
    </>
  );
}
