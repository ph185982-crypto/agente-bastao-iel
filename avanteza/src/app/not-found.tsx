import Link from "next/link";
export default function NotFound() {
  return (
    <div className="login-wrap">
      <div className="login-box" style={{ textAlign: "center" }}>
        <div className="card">
          <div className="eyebrow">Erro 404</div>
          <h1>Página não encontrada</h1>
          <p className="muted" style={{ margin: "10px 0 18px" }}>O endereço não existe ou você não tem acesso a ele.</p>
          <Link href="/" className="btn btn-orange">Voltar ao início</Link>
        </div>
      </div>
    </div>
  );
}
