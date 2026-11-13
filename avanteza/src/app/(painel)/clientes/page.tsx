import Link from "next/link";
import { userDb } from "@/lib/db";
import { createClient } from "@/app/actions";
import { Submit } from "@/components/Submit";
import { Flash } from "@/components/Flash";
import { ago } from "@/lib/format";

export default async function Clientes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const db = await userDb();
  const [{ data: clients }, { data: accounts }] = await Promise.all([
    db.from("clients").select("*").order("active", { ascending: false }).order("name"),
    db.from("marketplace_accounts").select("id, client_id, nickname, marketplace, status, last_collected_at"),
  ]);
  return (
    <>
      <Flash sp={sp} />
      <div className="page-head"><div><div className="eyebrow">Carteira</div><h1>Clientes</h1></div></div>
      <div className="card" style={{ marginTop: 12 }}>
        {(clients ?? []).length === 0 && <div className="empty">Nenhum cliente cadastrado.</div>}
        <ul className="list">
          {(clients ?? []).map((c) => {
            const accs = (accounts ?? []).filter((a) => a.client_id === c.id);
            return (
              <li key={c.id}>
                <Link href={`/clientes/${c.id}`} className="row" style={{ textDecoration: "none" }}>
                  <div>
                    <strong>{c.name}</strong> {!c.active && <span className="pill pill-sand">Inativo</span>}
                    <div className="small muted">
                      {accs.length === 0
                        ? "Nenhuma conta conectada"
                        : accs.map((a) => `${a.nickname ?? "conta"} (${a.status === "active" ? "ativa" : "reautorizar"}, coleta ${ago(a.last_collected_at)})`).join(" · ")}
                    </div>
                  </div>
                  <span aria-hidden="true">›</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <h2>Novo cliente</h2>
      <form action={createClient} className="card stack">
        <div className="field"><label htmlFor="n">Nome da empresa *</label><input id="n" name="name" required /></div>
        <div className="grid two">
          <div className="field"><label htmlFor="cn">Contato</label><input id="cn" name="contact_name" /></div>
          <div className="field"><label htmlFor="cp">WhatsApp</label><input id="cp" name="contact_phone" inputMode="tel" /></div>
        </div>
        <div className="field"><label htmlFor="ce">E-mail</label><input id="ce" name="contact_email" type="email" /></div>
        <div className="field"><label htmlFor="no">Observações</label><textarea id="no" name="notes" /></div>
        <Submit className="btn btn-orange">Cadastrar cliente</Submit>
      </form>
    </>
  );
}
