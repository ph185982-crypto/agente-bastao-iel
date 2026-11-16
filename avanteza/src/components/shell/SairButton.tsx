// Botão "Sair" do rodapé do menu: no menu recolhido vira só o ícone (o texto fica para leitores de tela e como dica).
import { logout } from "@/app/actions";
import { Icon } from "./Icons";

export function SairButton() {
  return (
    <form action={logout}>
      <button className="btn btn-sm btn-ghost sb-logout" title="Sair">
        <Icon name="logout" />
        <span className="sb-text">Sair</span>
      </button>
    </form>
  );
}
