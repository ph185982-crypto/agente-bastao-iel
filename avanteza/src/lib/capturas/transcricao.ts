// Transcrição dos áudios do .zip exportado. Só quando há provedor configurado (OPENAI_API_KEY); sem ele, o áudio entra
// como "áudio não transcrito". Injetável nos testes (sem rede). A chave nunca vai para log.
export type Transcritor = (audio: Buffer, nome: string) => Promise<string | null>;

const MIME: Record<string, string> = { opus: "audio/ogg", ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac", wav: "audio/wav", amr: "audio/amr" };

export function transcritorDoAmbiente(env: NodeJS.ProcessEnv = process.env): Transcritor | null {
  const chave = env.OPENAI_API_KEY?.trim();
  if (!chave) return null;
  const modelo = env.TRANSCRIPTION_MODEL?.trim() || "whisper-1";
  return async (audio, nome) => {
    const ext = (nome.split(".").pop() ?? "ogg").toLowerCase();
    const fd = new FormData();
    // .opus do WhatsApp é Ogg/Opus: a API aceita como .ogg
    fd.append("file", new Blob([new Uint8Array(audio)], { type: MIME[ext] ?? "audio/ogg" }), ext === "opus" ? nome.replace(/\.opus$/i, ".ogg") : nome);
    fd.append("model", modelo);
    fd.append("language", "pt");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${chave}` }, body: fd, signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as { text?: unknown } | null;
    const t = typeof j?.text === "string" ? j.text.trim() : "";
    return t || null;
  };
}
