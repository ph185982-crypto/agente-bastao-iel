import type { NextConfig } from "next";
import { origemVendedoria, redirecionamentosComercial, reescritasComercial } from "./src/lib/comercial/zona";
import { reescritasMcp } from "./src/lib/mcp/reescritas";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Importar conversa exportada do WhatsApp (.zip até 4 MB) pela tela Operações → Capturas.
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  // Comercial (Vendedor IA) sob /comercial/*: reescrita para VENDEDORIA_URL (src/lib/comercial/zona.ts).
  // Reverter = apagar estas duas funções (e COMERCIAL_ZONA=0 nos atalhos).
  async rewrites() {
    // beforeFiles: descoberta OAuth do conector do Claude (/.well-known/oauth-*), antes de qualquer outra rota (src/lib/mcp/reescritas.ts).
    return { beforeFiles: reescritasMcp(), afterFiles: reescritasComercial(origemVendedoria()), fallback: [] };
  },
  async redirects() {
    return redirecionamentosComercial();
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
