// Marcas em SVG inline (sem imagem externa, sem requisição): Meta (infinito), Facebook ("f"), Instagram e Google ("G" de quatro cores,
// pino do Maps e estrelas das avaliações), em cores oficiais aproximadas.
// Cada marca é uma forma fechada com fundo próprio (círculo/quadrado arredondado), então lê bem sobre o vidro dos temas claro e escuro.
// Sem `titulo`, o ícone é decorativo (aria-hidden); com `titulo`, vira uma imagem com rótulo acessível (use quando ele aparece sozinho).
import { useId } from "react";

export type TamanhoMarca = 16 | 20 | 24;
export type Marca = "meta" | "facebook" | "instagram" | "google";
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

/** Google: “G” de quatro cores (azul, verde, amarelo, vermelho) sobre disco claro (leitura no tema escuro). */
export function GoogleLogo(p: MarcaProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="11.5" fill="#FFFFFF" stroke="#DADCE0" />
      <g transform="translate(5.2 5.2) scale(0.2833)">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </g>
    </Svg>
  );
}

/** Pino do Google Maps: gota vermelha com miolo branco (contorno escuro sutil para ler sobre o vidro claro). */
export function PinoMaps(p: MarcaProps) {
  return (
    <Svg {...p}>
      <path d="M12 1.6c-4.1 0-7.4 3.2-7.4 7.3 0 5.3 6.2 12.2 6.9 13 .3.3.7.3 1 0 .7-.8 6.9-7.7 6.9-13 0-4.1-3.3-7.3-7.4-7.3z" fill="#EA4335" stroke="#A50E0E" strokeOpacity="0.45" strokeWidth="0.8" />
      <circle cx="12" cy="8.9" r="2.8" fill="#FFFFFF" />
    </Svg>
  );
}

/** Estrelas da avaliação (amarelo do Google; vazias com contorno). O valor vai em texto para leitores de tela. */
export function EstrelasGoogle({ nota, tamanho = 16 }: { nota: number | null; tamanho?: TamanhoMarca }) {
  const n = nota == null ? 0 : Math.max(0, Math.min(5, nota));
  return (
    <span className="estrelas" role="img" aria-label={nota == null ? "sem nota" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} de 5 estrelas`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const cheia = Math.max(0, Math.min(1, n - i));
        return (
          <svg key={i} width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <defs><clipPath id={`est-${i}-${Math.round(cheia * 10)}`}><rect x="0" y="0" width={24 * cheia} height="24" /></clipPath></defs>
            <path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5-4.8-4.5 6.5-.8z" fill="none" stroke="#E0A800" strokeWidth="1.4" strokeLinejoin="round" />
            {cheia > 0 && <path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5-4.8-4.5 6.5-.8z" fill="#FBBC04" clipPath={`url(#est-${i}-${Math.round(cheia * 10)})`} />}
          </svg>
        );
      })}
    </span>
  );
}

export function LogoMarca({ marca, ...p }: MarcaProps & { marca: Marca }) {
  return marca === "instagram" ? <InstagramLogo {...p} /> : marca === "facebook" ? <FacebookLogo {...p} /> : marca === "google" ? <GoogleLogo {...p} /> : <MetaLogo {...p} />;
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
