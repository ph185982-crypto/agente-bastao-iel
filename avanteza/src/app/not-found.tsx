import Link from "next/link";
export default function NotFound() {
  return (
    <div className="main"><h1>Página não encontrada</h1><p><Link href="/">Voltar ao painel</Link></p></div>
  );
}
