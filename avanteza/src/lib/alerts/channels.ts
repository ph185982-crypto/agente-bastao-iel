// Canais de notificação plugáveis. Para ligar o WhatsApp depois, implemente NotificationChannel
// e registre em getChannels().
import { envOptional, appUrl } from "../env";
import { fetchJson } from "../http";

export interface AlertMessage {
  clientName: string;
  title: string;
  message: string;
  severity: string;
}

export interface NotificationChannel {
  readonly name: string;
  enabled(): boolean;
  send(alerts: AlertMessage[], to?: string | null): Promise<void>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** E-mail via Resend (RESEND_API_KEY + ALERT_EMAIL_FROM). */
export class EmailChannel implements NotificationChannel {
  readonly name = "email";
  enabled() {
    return Boolean(envOptional("RESEND_API_KEY") && envOptional("ALERT_EMAIL_FROM"));
  }
  async send(alerts: AlertMessage[], to?: string | null) {
    const dest = to ?? envOptional("ALERT_EMAIL_TO");
    if (!dest || alerts.length === 0) return;
    const rows = alerts
      .map(
        (a) =>
          `<tr><td style="padding:8px;border-bottom:1px solid #EAD9C2"><strong>${esc(a.clientName)}</strong> · ${esc(a.severity)}<br>${esc(a.title)}<br><span style="color:#64748b">${esc(a.message)}</span></td></tr>`,
      )
      .join("");
    const html = `<div style="font-family:Manrope,Arial,sans-serif;background:#F5F0E6;padding:24px;color:#0B1B33">
      <h2 style="margin:0 0 12px">avanteza<span style="color:#FF6A1F">.</span> — ${alerts.length} alerta(s)</h2>
      <table style="width:100%;border-collapse:collapse;background:#fff">${rows}</table>
      <p><a href="${appUrl()}/alertas" style="color:#FF6A1F">Abrir painel</a></p></div>`;
    await fetchJson("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${envOptional("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: envOptional("ALERT_EMAIL_FROM"), to: [dest], subject: `Avanteza: ${alerts.length} alerta(s) novo(s)`, html }),
    }, { retries: 2 });
  }
}

/** Placeholder do WhatsApp: ligar quando houver provedor (ex.: API oficial do WhatsApp Business). */
export class WhatsAppChannel implements NotificationChannel {
  readonly name = "whatsapp";
  enabled() {
    return false;
  }
  async send() {
    /* a implementar */
  }
}

export function getChannels(): NotificationChannel[] {
  return [new EmailChannel(), new WhatsAppChannel()].filter((c) => c.enabled());
}
