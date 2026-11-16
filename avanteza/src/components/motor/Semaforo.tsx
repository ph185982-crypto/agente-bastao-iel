import { ROTULO_NIVEL, type Nivel } from "@/lib/motor/saude";

/** Semáforo de saúde do cliente: cor + texto (nunca só a cor). */
export function Semaforo({ nivel }: { nivel: Nivel }) {
  return <span className={`sem ${nivel}`}><i aria-hidden="true" />{ROTULO_NIVEL[nivel]}</span>;
}
