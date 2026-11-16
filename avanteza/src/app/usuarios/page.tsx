// Usuários e permissões por aplicativo (só administradores).
import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { adminDb } from "@/lib/db";
import { apps, APP_IDS } from "@/lib/apps";
import { saveUser } from "@/app/actions";
import { Submit } from "@/components/Submit";
import { Flash } from "@/components/Flash";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";
const ROLE: Record<string, string> = { admin: "Administrador (tudo)", member: "Membro (apps marcados)", reviewer: "Revisor (só leitura em Marketplaces)" };

function UserForm({ u }: { u?: { email: string; name: string | null; role: string; apps: string[]; active: boolean } }) {
  const names = Object.fromEntries(apps().map((a) => [a.id, a.name]));
  return (
    <form action={saveUser} className="card stack" style={{ marginTop: 0 }}>
      {u ? <input type="hidden" name="email" value={u.email} /> : <div className="field"><label>E-mail</label><input name="email" type="email" required /></div>}
      {u && <div><strong>{u.email}</strong> {!u.active && <span className="pill pill-danger">desativado</span>}</div>}
      <div className="field"><label>Nome</label><input name="name" defaultValue={u?.name ?? ""} /></div>
      <div className="field"><label>Papel</label>
        <select name="role" defaultValue={u?.role ?? "member"}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div><label>Aplicativos liberados (para membros)</label>
        <div className="btn-row">{APP_IDS.map((id) => <label key={id} className="check small"><input type="checkbox" name={`app_${id}`} defaultChecked={u?.apps?.includes(id)} /> {names[id]}</label>)}</div>
      </div>
      <div className="field"><label>{u ? "Nova senha (deixe vazio para manter)" : "Senha inicial (mín. 10 caracteres)"}</label><input name="password" type="password" autoComplete="new-password" minLength={10} /></div>
      <label className="check"><input type="checkbox" name="active" defaultChecked={u ? u.active : true} /> Ativo</label>
      <Submit className="btn btn-sm">{u ? "Salvar" : "Criar usuário"}</Submit>
    </form>
  );
}

export default async function Usuarios({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  await requireOwner();
  const { data: users } = await adminDb().from("admins").select("email, name, role, apps, active").neq("role", "client").order("email");
  return (
    <>
      <header className="topbar"><div className="topbar-inner"><Link href="/central" style={{ textDecoration: "none" }}><Logo /></Link><Link href="/central" className="btn btn-sm btn-ghost" style={{ color: "var(--sand)", borderColor: "var(--navy-2)" }}>Central</Link></div></header>
      <main className="main">
        <Flash sp={sp} />
        <div className="eyebrow">Avanteza ID</div>
        <h1>Usuários e <span className="serif">acessos</span></h1>
        <p className="muted small" style={{ marginTop: 4 }}>Administradores também precisam constar na variável ADMIN_EMAILS da Vercel. Mudanças valem no próximo login do usuário.</p>
        <h2>Equipe</h2>
        <div className="grid two">{(users ?? []).map((u: any) => <UserForm key={u.email} u={u} />)}</div>
        <h2>Novo usuário</h2>
        <UserForm />
      </main>
    </>
  );
}
