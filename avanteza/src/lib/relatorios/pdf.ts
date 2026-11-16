// PDF do relatório semanal, gerado no servidor com pdf-lib (JS puro, sem binário nativo: roda na Vercel) e a Manrope embutida.
// Identidade Avanteza: marinho #0B1B33, creme #F5F0E6, areia #EAD9C2, laranja #FF6A1F só como destaque; raio 6, sem sombras.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { MANROPE_BOLD_B64, MANROPE_MEDIUM_B64 } from "./fontes";
import { fmtPeriodo, fmtVariacao, kpisDoRelatorio, type DadosRelatorio, type ItemRelatorio } from "./semana";

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const MARINHO = hex("#0B1B33"), CREME = hex("#F5F0E6"), AREIA = hex("#EAD9C2"), LARANJA = hex("#FF6A1F"), SUAVE = hex("#4A5568"), VERDE = hex("#1E6B45"), VERMELHO = hex("#A12A1A");
const W = 595.28, H = 841.89, M = 44;

export interface EntradaPdf { dados: DadosRelatorio; abertura: string; destaques: string[]; publicadoEm?: string | null }

/** Remove o que a fonte não desenha (emoji, controles) para o PDF nunca falhar por um caractere. */
const limpar = (s: string) => s.replace(/[  ]/g, " ").replace(/[^ -ɏ–—‘’“”•…\n]/g, "");

function quebrar(texto: string, font: PDFFont, size: number, largura: number): string[] {
  const linhas: string[] = [];
  for (const par of limpar(texto).split("\n")) {
    let atual = "";
    for (const palavra of par.split(/\s+/).filter(Boolean)) {
      const tent = atual ? `${atual} ${palavra}` : palavra;
      if (font.widthOfTextAtSize(tent, size) <= largura) atual = tent;
      else {
        if (atual) linhas.push(atual);
        atual = palavra;
        while (font.widthOfTextAtSize(atual, size) > largura && atual.length > 1) {
          let corte = atual.length - 1;
          while (corte > 1 && font.widthOfTextAtSize(atual.slice(0, corte), size) > largura) corte--;
          linhas.push(atual.slice(0, corte));
          atual = atual.slice(corte);
        }
      }
    }
    linhas.push(atual);
  }
  return linhas;
}

const rect = (r: number, w: number, h: number) =>
  `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;

export async function gerarPdfRelatorio(e: EntradaPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(Buffer.from(MANROPE_MEDIUM_B64, "base64"), { subset: true });
  const bold = await doc.embedFont(Buffer.from(MANROPE_BOLD_B64, "base64"), { subset: true });
  const d = e.dados;
  doc.setTitle(`Relatório semanal — ${d.cliente} — ${fmtPeriodo(d.periodo.de, d.periodo.ate)}`);
  doc.setAuthor("Avanteza");
  doc.setCreator("Avanteza — Mapa do cliente");
  doc.setLanguage("pt-BR");

  let page: PDFPage = doc.addPage([W, H]);
  let y = H;
  const paginas: PDFPage[] = [page];

  const cabecalho = (primeira: boolean) => {
    const alto = primeira ? 132 : 54;
    page.drawRectangle({ x: 0, y: H - alto, width: W, height: alto, color: MARINHO });
    page.drawText("avanteza", { x: M, y: H - 38, size: 20, font: bold, color: CREME });
    page.drawText(".", { x: M + bold.widthOfTextAtSize("avanteza", 20), y: H - 38, size: 20, font: bold, color: LARANJA });
    if (primeira) {
      page.drawText("RELATÓRIO SEMANAL", { x: M, y: H - 72, size: 9, font: bold, color: AREIA });
      page.drawText(limpar(d.cliente).slice(0, 60), { x: M, y: H - 96, size: 22, font: bold, color: CREME });
      page.drawText(`Semana de ${fmtPeriodo(d.periodo.de, d.periodo.ate)}`, { x: M, y: H - 116, size: 11, font: reg, color: AREIA });
    } else {
      const t = `${limpar(d.cliente).slice(0, 50)} · ${fmtPeriodo(d.periodo.de, d.periodo.ate)}`;
      page.drawText(t, { x: W - M - reg.widthOfTextAtSize(t, 9), y: H - 34, size: 9, font: reg, color: AREIA });
    }
    y = H - alto - 26;
  };
  const novaPagina = () => {
    page = doc.addPage([W, H]);
    paginas.push(page);
    cabecalho(false);
  };
  const garantir = (altura: number) => { if (y - altura < 60) novaPagina(); };
  const titulo = (t: string) => {
    garantir(40);
    page.drawRectangle({ x: M, y: y - 2, width: 18, height: 3, color: LARANJA });
    y -= 18;
    page.drawText(t, { x: M, y, size: 13, font: bold, color: MARINHO });
    y -= 16;
  };
  const paragrafo = (t: string, o: { size?: number; font?: PDFFont; cor?: ReturnType<typeof rgb>; x?: number; largura?: number } = {}) => {
    const size = o.size ?? 10.5, font = o.font ?? reg, x = o.x ?? M, larg = o.largura ?? W - 2 * M;
    for (const l of quebrar(t, font, size, larg)) {
      garantir(size + 6);
      page.drawText(l, { x, y: y - size, size, font, color: o.cor ?? MARINHO });
      y -= size + 5;
    }
  };
  const lista = (itens: ItemRelatorio[], vazio: string) => {
    if (!itens.length) { paragrafo(vazio, { cor: SUAVE }); y -= 4; return; }
    for (const i of itens) {
      const data = i.data ? `${i.data.slice(8, 10)}/${i.data.slice(5, 7)}` : "";
      garantir(20);
      page.drawCircle({ x: M + 3, y: y - 6.5, size: 2.2, color: LARANJA });
      const largData = data ? reg.widthOfTextAtSize(data, 9.5) + 10 : 0;
      const linhas = quebrar(i.titulo, reg, 10.5, W - 2 * M - 14 - largData);
      if (data) page.drawText(data, { x: W - M - reg.widthOfTextAtSize(data, 9.5), y: y - 10, size: 9.5, font: reg, color: SUAVE });
      for (const l of linhas) { garantir(16); page.drawText(l, { x: M + 12, y: y - 10.5, size: 10.5, font: reg, color: MARINHO }); y -= 15.5; }
      if (i.detalhe) paragrafo(i.detalhe, { size: 9, cor: SUAVE, x: M + 12, largura: W - 2 * M - 12 });
      y -= 2;
    }
    y -= 6;
  };

  cabecalho(true);

  // Abertura
  paragrafo(e.abertura, { size: 11.5 });
  y -= 10;

  // Destaques
  if (e.destaques.length) {
    titulo("Destaques da semana");
    lista(e.destaques.map((t) => ({ titulo: t, data: null })), "");
  }

  // Números
  const kpis = kpisDoRelatorio(d);
  if (kpis.length) {
    titulo("Números da semana");
    for (const grupo of ["Marketplaces", "Anúncios (Meta)", "Instagram"] as const) {
      const ks = kpis.filter((k) => k.grupo === grupo);
      if (!ks.length) continue;
      garantir(90);
      page.drawText(grupo.toUpperCase(), { x: M, y: y - 9, size: 8.5, font: bold, color: SUAVE });
      y -= 16;
      const col = 4, gap = 8, larg = (W - 2 * M - gap * (col - 1)) / col, alt = 56;
      ks.forEach((k, idx) => {
        if (idx > 0 && idx % col === 0) y -= alt + gap;
        if (idx % col === 0) garantir(alt + 4);
        const x = M + (idx % col) * (larg + gap);
        page.drawSvgPath(rect(6, larg, alt), { x, y, color: CREME, borderColor: AREIA, borderWidth: 0.8 });
        page.drawText(limpar(k.rotulo), { x: x + 10, y: y - 16, size: 8.5, font: reg, color: SUAVE });
        page.drawText(limpar(k.valor), { x: x + 10, y: y - 34, size: 14, font: bold, color: MARINHO });
        if (k.variacao !== null) {
          page.drawText(limpar(fmtVariacao(k.variacao)).replace(" vs. semana anterior", " vs. anterior"), { x: x + 10, y: y - 48, size: 7.5, font: reg, color: k.variacao < 0 ? VERMELHO : VERDE });
        }
      });
      y -= alt + 16;
    }
  }

  titulo("Entregas concluídas");
  lista(d.entregas, "Nenhuma entrega concluída nesta semana.");
  titulo("O que vem nos próximos 7 dias");
  lista(d.proximas, "Nada agendado para os próximos dias.");
  titulo("Depende de você");
  lista(d.dependeDoCliente, "Nada parado esperando por você. Obrigado!");

  // Rodapé com número da página
  paginas.forEach((p, i) => {
    const t = `Página ${i + 1} de ${paginas.length}`;
    p.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.6, color: AREIA });
    p.drawText("Avanteza · Mapa do cliente · app.avanteza.com.br/mapa", { x: M, y: 26, size: 8, font: reg, color: SUAVE });
    p.drawText(t, { x: W - M - reg.widthOfTextAtSize(t, 8), y: 26, size: 8, font: reg, color: SUAVE });
  });
  return doc.save();
}

export const nomeArquivoPdf = (cliente: string, semana: string) =>
  `relatorio-${cliente.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${semana}.pdf`;
