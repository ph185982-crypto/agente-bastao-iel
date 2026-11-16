"use client";
// Imagem remota com fallback elegante: se não houver URL (já sanitizada no servidor) ou ela falhar, mostra o rótulo sobre fundo do tema.
import { useState } from "react";

export function Imagem({ src, alt, rotulo, className = "" }: { src: string | null; alt: string; rotulo: string; className?: string }) {
  const [falhou, setFalhou] = useState(false);
  return (
    <div className={`art ${className}`.trim()}>
      <span className="art-ph" aria-hidden={src && !falhou ? "true" : undefined}>{rotulo}</span>
      {src && !falhou && <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFalhou(true)} />}
    </div>
  );
}
