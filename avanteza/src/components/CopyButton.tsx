"use client";
import { useState } from "react";

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm btn-orange"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 2000);
        } catch {
          /* navegador sem permissão de área de transferência */
        }
      }}
    >
      {ok ? "Copiado ✓" : label}
    </button>
  );
}
