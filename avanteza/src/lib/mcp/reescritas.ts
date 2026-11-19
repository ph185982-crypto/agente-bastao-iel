// Descoberta OAuth do conector do Claude: /.well-known/* → rotas de metadados. Sem dependências (importado pelo next.config.ts).
// Vão em "beforeFiles": vencem qualquer outra reescrita (a zona /comercial não chega a /.well-known, mas fica garantido).
export function reescritasMcp() {
  return [
    { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/metadata/recurso" },
    { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/metadata/recurso" },
    { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata/servidor" },
    { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata/servidor" },
  ];
}
