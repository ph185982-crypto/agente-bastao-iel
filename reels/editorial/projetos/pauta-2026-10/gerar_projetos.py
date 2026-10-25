#!/usr/bin/env python
"""Gera os 10 reel.json da pauta de outubro/2026 (modelos "dado_*": graficos puros, sem foto).

Uso (da pasta reels/):  reels-voz/bin/python editorial/projetos/pauta-2026-10/gerar_projetos.py
Cada projeto fica em editorial/projetos/pauta-2026-10/<nome>/reel.json e usa o roteiro de
roteiros/pauta-2026-10/<nome>.md. A voz vem do cache em saida/.trabalho/<nome>.
"""
import json
import re
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent.parent
CENAS_ROT = RAIZ / "roteiros" / "pauta-2026-10"

COR = {"blue": "#1457D9", "orange": "#F47A1F", "ivory": "#F7F3EA", "charcoal": "#171717"}
CTA = {"texto": "SEGUE", "perfil": "@PEDRO_DESTRAVA"}


def T(linha, cor="ivory", anc=None, **kw):
    d = {"linha": linha, "cor": cor}
    if anc:
        d["ancora"] = anc
    d.update(kw)
    return d


def cena(id_, modelo, texto, fundo="carvao", selo=None, **kw):
    d = {"id": id_, "modelo": modelo, "fundo": fundo, "inicio": 0, "fim": 5, "texto": texto}
    if selo:
        d["selo"] = selo
    if fundo == "marfim":
        d["fundo_legenda"] = True
    d.update(kw)
    return d


def num(valor, anc, cor="orange", de=None, ate=None, casas=0, pre="", suf="", px=330, y=830):
    d = {"valor": valor, "ancora": anc, "cor": cor, "px": px, "y": y}
    if ate is not None:
        d["contar"] = {"de": de or 0, "ate": ate, "casas": casas, "prefixo": pre, "sufixo": suf}
    return d


def cta(texto, anc="Pedro"):
    return dict(CTA, ancora=anc)


A, B, M = "carvao", "azul", "marfim"
CONTA, ERRADO, DIN = "A CONTA", "VOCÊ APRENDEU ERRADO", "DINHEIRO DO BRASIL"

PROJETOS = {
    "01-luz-puxou-inflacao": ("A luz puxou a inflação de setembro", [
        cena("gancho", "dado_texto", [T("UM ÚNICO ITEM", "ivory", "único"), T("PUXOU A INFLAÇÃO", "orange", "puxou"),
                                      T("DE SETEMBRO.", "ivory", "setembro", desgaste=True)], A, CONTA, deco="riscos", transicao_saida="flash"),
        cena("indice", "dado_numero", [T("IPCA DE SETEMBRO", "ivory", "índice", cima=True)], A, CONTA,
             numero=num("0,82%", "zero", "orange", 0, 0.82, 2, suf="%"), transicao_saida="folha"),
        cena("luz", "dado_grade", [T("SÓ A ENERGIA ELÉTRICA", "ivory", "energia", cima=True), T("0,32 DOS 0,82", "orange", "trinta"),
                                   T("QUASE 4 EM CADA 10", "ivory", "quase")], B, CONTA,
             grade={"total": 10, "preenchidos": 4, "cor": "orange", "ancora": "quatro"}, transicao_saida="rasgo"),
        cena("casa", "dado_texto", [T("NÃO É NÚMERO", "charcoal", "não"), T("DE PLANILHA.", "charcoal", "planilha"),
                                    T("É A CONTA", "blue", "conta"), T("NA SUA CASA.", "orange", "casa")], M, CONTA, transicao_saida="whip"),
        cena("bandeira", "dado_numero", [T("BANDEIRA DE NOVEMBRO", "ivory", "bandeira", cima=True), T("VOCÊ SABE A SUA CONTA?", "ivory", "sabe")], B, CONTA,
             numero=dict(num("DIA 30", "dia", "orange", px=300), antes=0.1), transicao_saida="folha"),
        cena("cta", "cta_simples", [T("EU FAÇO", "ivory", "faço"), T("ESSA CONTA", "ivory", "conta"),
                                    T("POR VOCÊ.", "charcoal", "você", etiqueta_cor="orange")], B, CONTA, cta=cta("")),
    ]),
    "02-inflacao-estourou-teto": ("A inflação estourou o teto da meta", [
        cena("gancho", "dado_numero", [T("ESTOUROU O TETO", "orange", "estourou", cima=True), T("EM 12 MESES", "ivory", "doze")], A, CONTA,
             numero=num("4,58%", "Quatro", "ivory", 0, 4.58, 2, suf="%"), transicao_saida="flash"),
        cena("teto", "dado_barras", [T("A META TEM UM TETO", "ivory", "teto"), T("PASSOU POR 0,08", "orange", "oito")], A, CONTA,
             barras=[{"rotulo": "TETO DA META", "valor": 4.5, "texto": "4,5%", "cor": "blue", "ancora": "teto"},
                     {"rotulo": "INFLAÇÃO EM 12 MESES", "valor": 4.58, "texto": "4,58%", "cor": "orange", "ancora": "Passou"}],
             nota="barras a partir do zero · fonte: IBGE", transicao_saida="folha"),
        cena("mil", "dado_numero", [T("O QUE CUSTAVA R$ 1.000", "charcoal", "custava", cima=True), T("+ R$ 45,80", "orange", "oitenta")], M, CONTA,
             numero=num("R$ 1.045,80", "hoje", "blue", 1000, 1045.8, 2, pre="R$ ", px=230), transicao_saida="rasgo"),
        cena("salario", "dado_texto", [T("SEU SALÁRIO SUBIU", "ivory", "salário"), T("MAIS QUE ISSO?", "orange", "mais"),
                                       T("SE NÃO, VOCÊ", "ivory", "não"), T("FICOU MAIS POBRE.", "orange", "pobre", desgaste=True)], A, CONTA, transicao_saida="whip"),
        cena("cta", "cta_simples", [T("COMENTA", "ivory", "Comenta"), T("O SEU REAJUSTE", "ivory", "reajuste"),
                                    T("QUE EU FAÇO A CONTA.", "charcoal", "conta", etiqueta_cor="orange")], B, CONTA, cta=cta("")),
    ]),
    "03-oito-em-cada-dez-devem": ("Oito em cada dez famílias devem", [
        cena("gancho", "dado_grade", [T("FAMÍLIAS BRASILEIRAS", "ivory", "famílias", cima=True), T("8 EM CADA 10 TÊM DÍVIDA", "orange", "dívida")], A, CONTA,
             grade={"total": 10, "preenchidos": 8, "cor": "orange", "ancora": "Oito"}, transicao_saida="flash"),
        cena("cnc", "dado_numero", [T("FAMÍLIAS ENDIVIDADAS", "ivory", "Eram", cima=True), T("SEGUNDO A CNC · SET/2026", "ivory", "segundo")], A, CONTA,
             numero=num("81,7%", "oitenta", "orange", 0, 81.7, 1, suf="%"), transicao_saida="folha"),
        cena("diferenca", "dado_texto", [T("DÍVIDA NÃO É", "charcoal", "dívida"), T("O MESMO QUE ATRASO.", "orange", "mesmo"),
                                         T("CARTÃO, CARNÊ", "charcoal", "Cartão"), T("E FINANCIAMENTO", "blue", "financiamento")], M, CONTA, transicao_saida="rasgo"),
        cena("atraso", "dado_grade", [T("EM ATRASO, EM AGOSTO", "ivory", "em", cima=True), T("QUASE 3 EM CADA 10", "ivory", "quase")], B, CONTA,
             grade={"total": 10, "preenchidos": 3, "cor": "orange", "ancora": "três"}, transicao_saida="whip"),
        cena("renda", "dado_numero", [T("ATÉ 3 SALÁRIOS MÍNIMOS", "ivory", "salários", cima=True), T("TÊM DÍVIDA", "ivory", "dívida")], A, CONTA,
             numero=num("85,1%", "oitenta", "orange", 0, 85.1, 1, suf="%"), transicao_saida="folha"),
        cena("cta", "cta_simples", [T("QUAL A SUA", "ivory", "Qual"), T("DÍVIDA MAIS CARA?", "charcoal", "cara", etiqueta_cor="orange")], B, CONTA, cta=cta("")),
    ]),
    "04-black-friday-ticket-caiu": ("Black Friday: o ticket médio caiu", [
        cena("gancho", "dado_texto", [T("AS VENDAS", "ivory", "vendas"), T("DEVEM CRESCER.", "orange", "crescer"),
                                      T("MAS CADA COMPRA", "ivory", "compra"), T("DEVE CAIR.", "orange", "cair", desgaste=True)], A, CONTA, deco="riscos", transicao_saida="flash"),
        cena("projecao", "dado_numero", [T("PROJEÇÃO PARA O E-COMMERCE", "ivory", "projeção", cima=True), T("DE FATURAMENTO", "ivory", "faturamento")], A, CONTA,
             numero=num("+20,7%", "vinte", "orange", 0, 20.7, 1, pre="+", suf="%"), transicao_saida="folha"),
        cena("ticket", "dado_barras", [T("TÍQUETE MÉDIO", "ivory", "tíquete")], A, CONTA,
             barras=[{"rotulo": "2025", "valor": 309.7, "texto": "R$ 309,70", "cor": "blue", "ancora": "trezentos"},
                     {"rotulo": "2026 (PROJEÇÃO)", "valor": 268.2, "texto": "R$ 268,20", "cor": "orange", "ancora": "para"}],
             nota="barras a partir do zero · fonte: Neotrust/Confi", transicao_saida="rasgo"),
        cena("menos", "dado_numero", [T("EM CADA PEDIDO", "charcoal", "pedido")], M, CONTA,
             numero=num("−R$ 41,50", "Quarenta", "orange", 0, 41.5, 2, pre="−R$ ", px=250), transicao_saida="whip"),
        cena("ouseja", "dado_texto", [T("COMPRA MAIS VEZES,", "ivory", "compra"), T("MAS COISAS", "ivory", "coisas"), T("MAIS BARATAS.", "orange", "mais")], B, CONTA,
             transicao_saida="folha"),
        cena("cta", "cta_simples", [T("VAI COMPRAR", "ivory", "comprar"), T("O QUÊ DIA 27?", "charcoal", "dia", etiqueta_cor="orange")], B, CONTA, cta=cta("")),
    ]),
    "05-dois-numeros-mesmo-evento": ("Dois números para a mesma Black Friday", [
        cena("gancho", "dado_texto", [T("DOIS NÚMEROS", "ivory", "Dois"), T("O MESMO EVENTO.", "orange", "mesmo"),
                                      T("NENHUM MENTE.", "ivory", "nenhum")], A, ERRADO, deco="riscos", transicao_saida="flash"),
        cena("treze", "dado_numero", [T("UMA PROJEÇÃO DIZ", "ivory", "projeção", cima=True), T("NA BLACK FRIDAY", "ivory", "Black")], A, ERRADO,
             numero=num("R$ 13,3 BI", "treze", "orange", 0, 13.3, 1, pre="R$ ", suf=" BI", px=260), transicao_saida="folha"),
        cena("onze", "dado_numero", [T("OUTRA DIZ", "ivory", "Outra", cima=True)], B, ERRADO,
             numero=num("R$ 11,32 BI", "onze", "orange", 0, 11.32, 2, pre="R$ ", suf=" BI", px=250), transicao_saida="rasgo"),
        cena("dif", "dado_numero", [T("QUASE", "charcoal", "dois", cima=True), T("DE DIFERENÇA", "charcoal", "diferença")], M, ERRADO,
             numero=num("R$ 2 BI", "dois", "blue", 0, 1.98, 2, pre="R$ ", suf=" BI", px=280), transicao_saida="whip"),
        cena("metodo", "dado_linha", [T("A DIFERENÇA ESTÁ NO MÉTODO", "ivory", "método")], A, ERRADO,
             marcos=[{"ano": "4 DIAS", "rotulo": "26 A 29 DE NOVEMBRO", "ancora": "quatro", "cor": "orange"},
                     {"ano": "A SEMANA", "rotulo": "TODA A SEMANA DO EVENTO", "ancora": "semana", "cor": "blue"}], transicao_saida="folha"),
        cena("pergunte", "dado_texto", [T("TE DERAM UM NÚMERO?", "charcoal", "derem"), T("PERGUNTE", "orange", "pergunte"),
                                        T("COMO FOI CALCULADO.", "charcoal", "como")], M, ERRADO, transicao_saida="rasgo"),
        cena("cta", "cta_simples", [T("SEGUE O", "ivory", "Segue"), T("PEDRO DESTRAVA.", "charcoal", "Pedro", etiqueta_cor="orange")], B, ERRADO, cta=cta("")),
    ]),
    "06-ir-ate-5-mil": ("IR: quem ganha até R$ 5 mil", [
        cena("gancho", "dado_texto", [T("VOCÊ OUVIU QUE", "ivory", "ouviu"), T("ATÉ R$ 5 MIL", "orange", "até"),
                                      T("NÃO PAGA IR?", "ivory", "paga"), T("NÃO É BEM ASSIM.", "orange", "assim", desgaste=True)], A, ERRADO, deco="riscos", transicao_saida="flash"),
        cena("desconto", "dado_texto", [T("NÃO ZEROU A TABELA.", "charcoal", "zerou"), T("CRIOU UM DESCONTO", "blue", "criou"),
                                        T("QUE CANCELA O IMPOSTO", "charcoal", "cancela")], M, ERRADO, transicao_saida="folha"),
        cena("faixa", "dado_linha", [T("O DESCONTO DIMINUI", "ivory", "diminuindo")], A, ERRADO,
             marcos=[{"ano": "R$ 5.000", "rotulo": "IMPOSTO ZERADO", "ancora": "Entre", "cor": "orange"},
                     {"ano": "R$ 7.350", "rotulo": "TABELA NORMAL", "ancora": "trezentos", "cor": "blue"}], transicao_saida="rasgo"),
        cena("maximo", "dado_numero", [T("ACIMA DISSO", "ivory", "Acima", cima=True), T("ALÍQUOTA MÁXIMA", "ivory", "cento")], A, ERRADO,
             numero=num("27,5%", "vinte", "orange", 0, 27.5, 1, suf="%"), transicao_saida="whip"),
        cena("fontes", "dado_texto", [T("MAIS DE UMA FONTE?", "ivory", "fonte"), T("A CONTA", "ivory", "conta"), T("SOMA TUDO.", "orange", "soma")], B, ERRADO,
             transicao_saida="folha"),
        cena("cta", "cta_simples", [T("EM QUAL FAIXA", "ivory", "faixa"), T("VOCÊ ESTÁ?", "charcoal", "está", etiqueta_cor="orange")], B, ERRADO, cta=cta("")),
    ]),
    "07-reforma-tributaria-2026-teste": ("Reforma tributária: o que muda no seu preço", [
        cena("gancho", "dado_texto", [T("A REFORMA", "ivory", "reforma"), T("NÃO AUMENTOU", "orange", "aumentou"),
                                      T("O SEU PREÇO", "ivory", "preço"), T("EM 2026.", "ivory", "em", desgaste=True)], A, ERRADO, deco="riscos", transicao_saida="flash"),
        cena("teste", "dado_texto", [T("ANO DE TESTE", "charcoal", "teste"), T("0,9% DE CBS", "blue", "nove"), T("0,1% DE IBS", "orange", "vírgula")], M, ERRADO,
             transicao_saida="folha"),
        cena("um", "dado_numero", [T("SOMANDO", "ivory", "Somando", cima=True), T("SÓ PARA MOSTRAR,", "ivory", "mostrar"),
                                   T("NÃO PARA COBRAR.", "orange", "cobrar")], B, ERRADO,
             numero=num("1%", "um", "orange", 0, 1, 0, suf="%", px=380), transicao_saida="rasgo"),
        cena("icms", "dado_numero", [T("A MUDANÇA DE VERDADE", "ivory", "mudança", cima=True), T("ICMS E ISS COMEÇAM A CAIR", "ivory", "começam")], A, ERRADO,
             numero=num("2029", "vinte", "orange", px=380), transicao_saida="whip"),
        cena("completo", "dado_numero", [T("SISTEMA COMPLETO", "charcoal", "sistema", cima=True)], M, ERRADO,
             numero=num("2033", "dois", "blue", px=380), transicao_saida="folha"),
        cena("cta", "cta_simples", [T("O QUE MUDA", "ivory", "muda"), T("NO SEU NEGÓCIO?", "charcoal", "negócio", etiqueta_cor="orange")], B, ERRADO, cta=cta("")),
    ]),
    "08-um-real-valia-2750": ("Quando um real valia 2.750 cruzeiros", [
        cena("gancho", "dado_numero", [T("EM 1994, 1 REAL VALIA", "ivory", "Em", cima=True), T("CRUZEIROS REAIS", "ivory", "cruzeiros")], A, DIN,
             numero=num("2.750", "dois", "orange", 0, 2750, 0, px=380), transicao_saida="flash"),
        cena("troca", "dado_texto", [T("1º DE JULHO", "blue", "primeiro"), T("O DINHEIRO DE TODO MUNDO", "charcoal", "dinheiro"),
                                     T("FOI TROCADO.", "orange", "trocado")], M, DIN, transicao_saida="folha"),
        cena("antes", "dado_texto", [T("OS PREÇOS SUBIAM", "ivory", "preços"), T("SEM PARAR.", "orange", "parar"),
                                     T("A TROCA FOI", "ivory", "troca"), T("A VIRADA DO PLANO.", "orange", "virada")], A, DIN, transicao_saida="rasgo"),
        cena("urv", "dado_texto", [T("UMA MOEDA VIRTUAL:", "ivory", "moeda"), T("A URV.", "orange", "URV"), T("PREPAROU A TROCA.", "ivory", "preparar")], B, DIN,
             transicao_saida="whip"),
        cena("cta", "cta_simples", [T("QUEM VIVEU", "ivory", "viveu"), T("COMENTA A", "ivory", "Comenta"),
                                    T("SUA HISTÓRIA.", "charcoal", "história", etiqueta_cor="orange")], B, DIN, cta=cta("")),
    ]),
    "09-moeda-que-durou-dez-meses": ("O dinheiro que durou menos de um ano", [
        cena("gancho", "dado_texto", [T("UMA MOEDA", "ivory", "moeda"), T("DUROU MENOS", "orange", "durou"), T("DE UM ANO.", "ivory", "ano", desgaste=True)],
             A, DIN, deco="riscos", transicao_saida="flash"),
        cena("nasce", "dado_linha", [T("O CRUZEIRO REAL", "ivory", "cruzeiro")], A, DIN,
             marcos=[{"ano": "OUT/1993", "rotulo": "COMEÇA A CIRCULAR", "ancora": "outubro", "cor": "orange"}], transicao_saida="folha"),
        cena("zeros", "dado_numero", [T("CADA CRUZEIRO REAL VALIA", "charcoal", "Cada", cima=True), T("TIRARAM 3 ZEROS.", "orange", "zeros")], M, DIN,
             numero=num("1.000", "mil", "blue", 0, 1000, 0, px=380), transicao_saida="rasgo"),
        cena("fim", "dado_linha", [T("MENOS DE UM ANO", "ivory", "Mesmo")], A, DIN,
             marcos=[{"ano": "OUT/1993", "rotulo": "NASCE O CRUZEIRO REAL", "ancora": "assim", "cor": "orange"},
                     {"ano": "SET/1994", "rotulo": "SUBSTITUÍDO PELO REAL", "ancora": "setembro", "cor": "blue"}], transicao_saida="whip"),
        cena("nome", "dado_texto", [T("TIRARAM ZEROS,", "ivory", "zeros"), T("TROCARAM DE NOME,", "ivory", "nome"),
                                    T("O PREÇO CONTINUOU SUBINDO.", "orange", "subindo")], B, DIN, transicao_saida="folha"),
        cena("cta", "cta_simples", [T("O QUE MUDOU", "ivory", "mudou"), T("FOI O PLANO.", "charcoal", "plano", etiqueta_cor="orange")], B, DIN, cta=cta("")),
    ]),
    "10-selic-13-75": ("O que 13,75% de juros fazem com R$ 10 mil", [
        cena("gancho", "dado_numero", [T("A 13,75% AO ANO", "ivory", "taxa"), T("QUANTO VIRA?", "orange", "Quanto")], A, CONTA,
             numero=num("R$ 10.000", "Dez", "ivory", 0, 10000, 0, pre="R$ ", px=250), transicao_saida="flash"),
        cena("vira", "dado_numero", [T("ANTES DO IMPOSTO", "charcoal", "imposto")], M, CONTA,
             numero=num("R$ 11.375", "Onze", "blue", 10000, 11375, 0, pre="R$ ", px=250), transicao_saida="folha"),
        cena("jogo", "dado_texto", [T("VIRA O JOGO.", "orange", "jogo"), T("O MESMO JURO", "ivory", "mesmo"),
                                    T("PAGA O INVESTIMENTO", "ivory", "investimento"), T("ENCARECE O FINANCIAMENTO.", "orange", "encarece")], A, CONTA,
             transicao_saida="rasgo"),
        cena("copom", "dado_texto", [T("O COPOM DECIDE", "charcoal", "Copom"), T("A TAXA", "blue", "taxa"),
                                     T("NO COMEÇO DE NOVEMBRO.", "orange", "novembro")], M, CONTA, transicao_saida="whip"),
        cena("cta", "cta_simples", [T("O QUE VOCÊ FARIA", "ivory", "faria"), T("COM R$ 10 MIL?", "charcoal", "mil", etiqueta_cor="orange")], B, CONTA, cta=cta("")),
    ]),
}

BASE = {
    "duration": 60, "fps": 30, "format": "1080x1920", "profile": "@pedro_destrava", "colors": COR,
    "fontes": {"titulo": "fontes/Anton-Regular.ttf", "apoio": "fontes/Montserrat-VF.ttf"},
    "zona_segura": {"topo": 180, "base": 300, "lados": 80},
    "legendas": {"ativo": True, "y": 1520, "tamanho": 56, "palavras_min": 2, "palavras_max": 5, "esconder_se_repetida": 0.7},
    "ritmo": {"modo": "compacto", "velocidade": 1.12, "pausa_max": 0.1, "antes_padrao": 0.12, "depois": 0.28, "final": 1.7, "cena_min": 1.6,
              "fator_padrao": 0.7, "socos": True, "empurrao": 0.05, "antecipar": 0.06,
              "observacao": "modo compacto: cena = respiro + fala + respiro; animacoes internas encolhem pelo fator"},
    "duracao_alvo": [18, 60],
}


def main():
    for nome, (titulo, cenas) in PROJETOS.items():
        n_rot = len(re.findall(r"^## Cena", (CENAS_ROT / f"{nome}.md").read_text(encoding="utf-8"), flags=re.M))
        assert n_rot == len(cenas), f"{nome}: roteiro tem {n_rot} cenas, projeto tem {len(cenas)}"
        cenas = [c for c in cenas]
        cfg = dict(BASE, titulo=titulo, nome=nome,
                   narracao={"roteiro": f"roteiros/pauta-2026-10/{nome}.md", "pasta": f"saida/.trabalho/{nome}"},
                   trilha={"arquivo": None, "sintetizada": {"bpm": 128, "tom": "D", "intensidade": [0.85, 0.9, 0.7, 1.0, 0.85, 0.95, 0.8][:len(cenas)]},
                           "loudness_lufs": -14},
                   cenas=cenas)
        for c in cenas:   # legenda: destaca a palavra da primeira linha laranja
            lin = next((l for l in c["texto"] if l["cor"] == "orange" and l.get("ancora")), None)
            if lin:
                c["destaque_legenda"] = lin["ancora"]
        pasta = AQUI / nome
        pasta.mkdir(exist_ok=True)
        (pasta / "reel.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
        fontes = re.search(r"<!--(.*?)-->", (CENAS_ROT / f"{nome}.md").read_text(encoding="utf-8"), flags=re.S)
        (pasta / "fontes.txt").write_text(f"{titulo}\n{'=' * len(titulo)}\n{fontes.group(1).strip() if fontes else ''}\n", encoding="utf-8")
    print(f"{len(PROJETOS)} projetos gerados")


if __name__ == "__main__":
    main()
