// Marcas em SVG inline (sem imagem externa, sem requisição): Meta (infinito), Facebook ("f") e Instagram, em cores oficiais aproximadas.
// Cada marca é uma forma fechada com fundo próprio (círculo/quadrado arredondado), então lê bem sobre o vidro dos temas claro e escuro.
// Sem `titulo`, o ícone é decorativo (aria-hidden); com `titulo`, vira uma imagem com rótulo acessível (use quando ele aparece sozinho).
import { useId } from "react";

export type TamanhoMarca = 16 | 20 | 24;
export type Marca = "meta" | "facebook" | "instagram";
export interface MarcaProps { tamanho?: TamanhoMarca; titulo?: string; className?: string }

function Svg({ tamanho = 20, titulo, className, children }: MarcaProps & { children: React.ReactNode }) {
  const a11y = titulo ? { role: "img" as const, "aria-label": titulo } : { "aria-hidden": true as const, focusable: "false" as const };
  return (
    <svg className={`marca-logo ${className ?? ""}`.trim()} width={tamanho} height={tamanho} viewBox="0 0 24 24" {...a11y}>
      {titulo ? <title>{titulo}</title> : null}
      {children}
    </svg>
  );
}

/** Símbolo da Meta: infinito azul sobre disco claro (o disco garante leitura no tema escuro). */
export function MetaLogo(p: MarcaProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="11.5" fill="#FFFFFF" stroke="#0866FF" strokeOpacity="0.35" />
      <path d="M12 12c-1.2-2.1-2.4-4.4-4.3-4.4-2 0-3.5 2.2-3.5 4.4s1.4 4.4 3.1 4.4c2 0 3.4-2.3 4.7-4.4zm0 0c1.2 2.1 2.4 4.4 4.3 4.4 2 0 3.5-2.2 3.5-4.4s-1.4-4.4-3.1-4.4c-2 0-3.4 2.3-4.7 4.4z"
        fill="none" stroke="#0866FF" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Facebook: “f” branco em disco azul. */
export function FacebookLogo(p: MarcaProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="11.5" fill="#1877F2" />
      <path d="M13.3 20v-6.6h2.2l.4-2.7h-2.6V9c0-.8.3-1.3 1.4-1.3H16V5.3c-.3 0-1.1-.1-2-.1-2.1 0-3.5 1.3-3.5 3.600v2H8.200v2.700h2.300V20z" fill="#FFFFFF" />
    </Svg>
  );
}

/** Instagram: câmera branca em quadrado arredondado com o degradê da marca (amarelo → rosa → roxo). */
export function InstagramLogo(p: MarcaProps) {
  const id = useId().replace(/:/g, "");
  return (
    <Svg {...p}>
      <defs>
        <radialGradient id={`ig${id}`} cx="30%" cy="107%" r="150%">
          <stop offset="0" stopColor="#FED576" /><stop offset="0.26" stopColor="#F47133" /><stop offset="0.61" stopColor="#BC3081" /><stop offset="1" stopColor="#4C63D2" />
        </radialGradient>
      </defs>
      <rect x="0.5" y="0.5" width="23" height="23" rx="6.5" fill={`url(#ig${id})`} />
      <rect x="5.2" y="5.2" width="13.6" height="13.6" rx="4.2" fill="none" stroke="#FFFFFF" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="#FFFFFF" strokeWidth="1.7" />
      <circle cx="16.1" cy="7.9" r="1" fill="#FFFFFF" />
    </Svg>
  );
}

export function LogoMarca({ marca, ...p }: MarcaProps & { marca: Marca }) {
  return marca === "instagram" ? <InstagramLogo {...p} /> : marca === "facebook" ? <FacebookLogo {...p} /> : <MetaLogo {...p} />;
}

/** Marca + texto lado a lado (cabeçalhos de bloco, abas e selos de fonte). A marca é decorativa: o texto já diz o nome. */
export function MarcaRotulo({ marca, tamanho = 20, children, className }: { marca: Marca; tamanho?: TamanhoMarca; children: React.ReactNode; className?: string }) {
  return <span className={`marca-rotulo ${className ?? ""}`.trim()}><LogoMarca marca={marca} tamanho={tamanho} />{children}</span>;
}

/** Ícone do tipo de mídia (Reels, imagem, carrossel, vídeo): traço em currentColor, decorativo (o rótulo do tipo vem em texto). */
export function IconeTipoMidia({ tipo, tamanho = 16 }: { tipo: string; tamanho?: TamanhoMarca }) {
  const t = tipo.toLowerCase();
  const k = t.includes("reel") ? "reel" : t.includes("carrossel") || t.includes("carousel") ? "carrossel" : t.includes("v") && t.includes("deo") ? "video" : "imagem";
  return (
    <svg className="marca-tipo" width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {k === "reel" && <><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><path d="M3.8 9h16.4M9.2 3.6 12 9M14.6 3.6 17.2 9" /><path d="m10.6 12.6 4 2.4-4 2.4z" fill="currentColor" stroke="none" /></>}
      {k === "imagem" && <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.7" /><path d="m4.5 17.5 5-4.6 3.6 3.2 2.4-2 4 3.4" /></>}
      {k === "carrossel" && <><rect x="6.5" y="5.5" width="14" height="13" rx="3" /><path d="M3.5 8v8" /><path d="M9.5 15.5l3-3 2.2 2 2.3-2.3 2.5 2.6" /></>}
      {k === "video" && <><rect x="3.5" y="5.5" width="17" height="13" rx="3.5" /><path d="m10.6 9.4 4 2.6-4 2.6z" fill="currentColor" stroke="none" /></>}
    </svg>
  );
}
