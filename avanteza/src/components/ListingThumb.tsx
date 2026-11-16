"use client";
import { useEffect, useRef, useState } from "react";
import { safeImageUrl } from "@/lib/marketplaces/images";

/** Miniatura quadrada (48px) do anúncio, com fallback de inicial quando não há foto (ou ela não carrega).
 *  <img> simples (sem next/image): as URLs vêm de CDNs de vários marketplaces e não dependem de remotePatterns. */
export function ListingThumb({ url, title }: { url?: string | null; title?: string | null }) {
  const src = safeImageUrl(url);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // a imagem pode ter falhado antes da hidratação (o evento de erro já passou)
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, [src]);
  const initial = (title ?? "").trim().charAt(0).toUpperCase() || "•";
  if (!src || failed) return <span className="thumb ph" aria-hidden="true">{initial}</span>;
  return (
    <span className="thumb">
      <img ref={ref} src={src} alt={title ?? ""} width={48} height={48} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    </span>
  );
}
