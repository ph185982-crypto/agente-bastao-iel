from flask import Flask, request, jsonify
import pdfplumber
import re
import tempfile
import os
from datetime import datetime

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

CNPJ_IEL = "01.647.296/0001-08"

DOMINIOS_BLOQUEADOS = {
    "fieg.com.br", "ielgoias.com.br", "clicksign.com", "iel.org.br", "linhaetica.com.br",
}
USUARIOS_BLOQUEADOS = {
    "linhaetica", "contratos.iel", "leandra.iel", "humberto.iel",
    "pedrohms.iel", "victorleite.iel", "comunicacao.iel",
}

MESES_PT = {
    "janeiro":"01","fevereiro":"02","março":"03","marco":"03",
    "abril":"04","maio":"05","junho":"06","julho":"07",
    "agosto":"08","setembro":"09","outubro":"10","novembro":"11","dezembro":"12",
}
MESES_ABREV = {
    "jan":"01","fev":"02","mar":"03","abr":"04","mai":"05","jun":"06",
    "jul":"07","ago":"08","set":"09","out":"10","nov":"11","dez":"12",
}

ERRO = "[ERRO - VERIFICAR]"
NAO_ENCONTRADO = "[A CONFIRMAR]"

ASSUNTO_TEMPLATE = "Faturamento – Logística Reversa | {razao_social} | {data_assinatura}"

CORPO_TEMPLATE = """\
Boa tarde, Isadora e Frederico,

Segue abaixo as informações de faturamento referentes à venda do produto
Logística Reversa para o cliente identificado abaixo. A oportunidade já foi
ganha no Néctar e o status no Integrador consta como "Processado".

DADOS DO CLIENTE E FATURAMENTO
  * Razão Social: {razao_social}
  * CNPJ: {cnpj}
  * Endereço: {endereco}
  * Contato: {nome_contato}
  * Telefone: {telefone}
  * E-mail do financeiro: {email_financeiro}

Condições Comerciais
  * Valor total negociado: {valor_total}
  * Forma de pagamento: {forma_pagamento}
  * Condições: {parcelamento}
  * Data do primeiro vencimento: {primeiro_vencimento}

Solicito que, com base nessas informações, seja providenciado:
  * Emissão da Nota Fiscal;
  * Geração do link de pagamento (cartão de crédito) ou emissão do 1º boleto;
  * Envio do boleto para o cliente por e-mail com os itens acima;
  * Contato com o cliente para orientações dos próximos passos.

Atenciosamente,"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalizar(texto):
    if not texto:
        return ""
    texto = re.sub(r"[ \t]+", " ", texto)
    texto = re.sub(r" \n", "\n", texto)
    texto = re.sub(r"\n{3,}", "\n\n", texto)
    return texto.strip()


def _m(padrao, texto, flags=re.IGNORECASE):
    m = re.search(padrao, texto, flags)
    return m.group(1).strip() if m else ""


def _email_permitido(email):
    email = email.lower()
    usuario, dominio = email.rsplit("@", 1) if "@" in email else (email, "")
    if any(dominio == d or dominio.endswith("." + d) for d in DOMINIOS_BLOQUEADOS):
        return False
    if any(usuario == u or usuario.endswith("." + u) for u in USUARIOS_BLOQUEADOS):
        return False
    return True


def _normalizar_cnpj(raw):
    d = re.sub(r"\D", "", raw)
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:14]}"
    return raw


def _data_extenso(texto):
    m = re.search(r"(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})", texto, re.IGNORECASE)
    if not m:
        return ""
    dia, mes_str, ano = m.group(1), m.group(2).lower(), m.group(3)
    mes = MESES_PT.get(mes_str)
    return f"{int(dia):02d}/{mes}/{ano}" if mes else ""


def _data_abrev(texto):
    m = re.search(r"(\d{1,2})\s+([a-z]{3})\w*\s+(\d{4})", texto, re.IGNORECASE)
    if not m:
        return ""
    dia, abrev, ano = m.group(1), m.group(2).lower(), m.group(3)
    mes = MESES_ABREV.get(abrev)
    return f"{int(dia):02d}/{mes}/{ano}" if mes else ""

# ---------------------------------------------------------------------------
# Extração de texto
# ---------------------------------------------------------------------------

def extrair_texto(path):
    paginas = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            paginas.append(normalizar(page.extract_text() or ""))
    texto = "\n".join(paginas)

    idx = re.search(r"\bCONTRATADO\b", texto)
    sec_contratante = texto[:idx.start()] if idx else texto

    idx_click = texto.lower().find("clicksign")
    log = texto[idx_click:] if idx_click >= 0 else texto[-3000:]

    return texto, sec_contratante, log

# ---------------------------------------------------------------------------
# Extração por campo
# ---------------------------------------------------------------------------

def extrair_razao_social(sec):
    v = _m(r"Raz[aã]o\s+Social:\s*([^\n]+)", sec)
    if v:
        v = v.rstrip(".,;:")
        if "INSTITUTO EUVALDO LODI" not in v.upper():
            return v
    return ""


def extrair_cnpj(sec):
    v = _m(r"CNPJ:\s*(\d{2}[\.\s]?\d{3}[\.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2})", sec)
    if v:
        fmt = _normalizar_cnpj(v)
        if fmt != CNPJ_IEL:
            return fmt
    for raw in re.findall(r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}", sec):
        fmt = _normalizar_cnpj(raw)
        if fmt != CNPJ_IEL:
            return fmt
    return ""


def extrair_endereco(sec):
    v = _m(
        r"Endere[çc]o:\s*(.+?)(?=\n(?:Representante|Cargo|E-?mail|CNPJ|CPF)|$)",
        sec, re.IGNORECASE | re.DOTALL
    )
    return " ".join(v.split()) if v else ""


def extrair_representante(sec):
    v = _m(r"Representante:\s*([^\n]+)", sec)
    return v.rstrip(".,;:") if v else ""


def extrair_nome_contato(sec):
    return extrair_representante(sec)


def extrair_telefone(sec):
    v = _m(
        r"(?:Telefone|Tel|Celular|Fone)[:\s]+(\(?\d{2}\)?\s*[\d\s\-]{8,13})",
        sec,
    )
    if v:
        return re.sub(r"\s+", " ", v).strip()
    m = re.search(r"\((\d{2})\)\s*(\d{4,5})[-\s]?(\d{4})", sec)
    if m:
        return f"({m.group(1)}) {m.group(2)}-{m.group(3)}"
    return ""


def extrair_email(texto, log, representante):
    # Prioridade 1: signatário principal — "assinou." sem "como" ou "para"
    signatarios = re.findall(
        r"\bassinou\.\s+Pontos\s+de\s+autentica[çc][aã]o.*?Token\s+via\s+E-?mail\s+([\w.+\-]+@[\w.\-]+\.\w+)",
        log, re.IGNORECASE
    )
    externos = [e.lower() for e in signatarios if _email_permitido(e)]

    if externos and representante:
        primeiro_nome = representante.strip().split()[0].lower()
        for trecho in re.split(r"\n{2,}", log):
            if primeiro_nome in trecho.lower():
                for email in re.findall(
                    r"\bassinou\.\s+Pontos.*?Token\s+via\s+E-?mail\s+([\w.+\-]+@[\w.\-]+\.\w+)",
                    trecho, re.IGNORECASE
                ):
                    if _email_permitido(email):
                        return email.lower()

    if externos:
        return externos[0]

    # Prioridade 2: qualquer Token via E-mail no log
    for email in re.findall(r"Token\s+via\s+E-?mail\s+([\w.+\-]+@[\w.\-]+\.\w+)", log, re.IGNORECASE):
        if _email_permitido(email):
            return email.lower()

    # Prioridade 3: qualquer e-mail externo no log
    for email in re.findall(r"[\w.+\-]+@[\w.\-]+\.\w+", log):
        if _email_permitido(email):
            return email.lower()

    for email in re.findall(r"[\w.+\-]+@[\w.\-]+\.\w+", texto):
        if _email_permitido(email):
            return email.lower()

    return ""


def extrair_valor(texto):
    bloco = re.search(r"VALOR(.{1,80}?)MODALIDADE", texto, re.DOTALL | re.IGNORECASE)
    if bloco:
        val = re.search(r"R\$\s*([\d.,]+)", bloco.group(1))
        if val:
            return f"R$ {val.group(1).strip()}"
    for p in [r"VALOR\s+R\$\s*([\d.,]+)", r"VALOR\s*\n\s*R\$\s*([\d.,]+)", r"VALOR\s+R\$([\d.,]+)"]:
        v = _m(p, texto)
        if v:
            return f"R$ {v}"
    m = re.search(r"VALOR[^\n]{0,30}(\d{1,3}(?:\.\d{3})*,\d{2})", texto)
    if m:
        return f"R$ {m.group(1)}"
    return ""


def extrair_modalidade(texto):
    bloco = re.search(r"MODALIDADE(.{1,100}?)PARCELAMENTO", texto, re.DOTALL | re.IGNORECASE)
    conteudo = " ".join(bloco.group(1).split()).lower() if bloco else ""
    if "boleto" in conteudo:
        return "Boleto bancário"
    if "cart" in conteudo:
        return "Cartão de crédito"
    if "pix" in conteudo:
        return "PIX"
    v = _m(r"MODALIDADE\s*\n?\s*([^\n]+)", texto)
    if v:
        vl = v.lower()
        if "boleto" in vl: return "Boleto bancário"
        if "cart" in vl:   return "Cartão de crédito"
        if "pix" in vl:    return "PIX"
        return v
    return ""


def extrair_parcelamento(texto):
    # Aceita '12x', '12 vezes' e 'À vista' — modelos 1 e 2
    v = _m(r"PARCELAMENTO\s*\n?\s*(\d+\s*(?:x|vez(?:es)?)|[àÀ]\s*vista[^\n]*)", texto, re.IGNORECASE)
    if v:
        m = re.match(r"(\d+)\s*(?:x|vez(?:es)?)", v, re.IGNORECASE)
        if m:
            n = int(m.group(1))
            return "À vista" if n <= 1 else f"Parcelado em {n}x"
        return "À vista"
    m = re.search(r"(\d+)\s*(?:x\b|vez(?:es)?)", texto, re.IGNORECASE)
    if m:
        n = int(m.group(1))
        return "À vista" if n <= 1 else f"Parcelado em {n}x"
    if re.search(r"\b[àa]\s*vista\b", texto, re.IGNORECASE):
        return "À vista"
    return ""


def extrair_vencimento(texto):
    v = _m(
        r"(?:primeiro\s+vencimento|vencimento\s+da\s+primeira\s+parcela)[:\s]+(\d{2}/\d{2}/\d{4})",
        texto
    )
    return v if v else NAO_ENCONTRADO


def extrair_data_assinatura(texto, log):
    v = _m(r"Goi[aâ]nia,?\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})", texto)
    if v:
        d = _data_extenso(v)
        if re.match(r"\d{2}/\d{2}/\d{4}", d):
            return d
    datas = re.findall(
        r"\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\s+\d{4}",
        log, re.IGNORECASE
    )
    if datas:
        d = _data_abrev(datas[-1])
        if d:
            return d
    datas = re.findall(r"\d{2}/\d{2}/\d{4}", texto)
    return datas[0] if datas else datetime.today().strftime("%d/%m/%Y")


def validar(dados):
    if not dados["razao_social"] or "INSTITUTO EUVALDO LODI" in dados["razao_social"].upper():
        dados["razao_social"] = ERRO
    cnpj = dados["cnpj"]
    if not re.match(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$", cnpj) or cnpj == CNPJ_IEL:
        dados["cnpj"] = ERRO
    email = dados["email_financeiro"]
    if email and not _email_permitido(email):
        dados["email_financeiro"] = ERRO
    return dados


def processar(path):
    texto, sec_contratante, log = extrair_texto(path)
    dados = {
        "razao_social":        extrair_razao_social(sec_contratante),
        "cnpj":                extrair_cnpj(sec_contratante),
        "endereco":            extrair_endereco(sec_contratante),
        "representante":       extrair_representante(sec_contratante),
        "nome_contato":        extrair_nome_contato(sec_contratante),
        "telefone":            extrair_telefone(sec_contratante),
        "email_financeiro":    "",
        "valor_total":         extrair_valor(texto),
        "forma_pagamento":     extrair_modalidade(texto),
        "parcelamento":        extrair_parcelamento(texto),
        "primeiro_vencimento": extrair_vencimento(texto),
        "data_assinatura":     extrair_data_assinatura(texto, log),
    }
    dados["email_financeiro"] = extrair_email(texto, log, dados["representante"])
    for k, v in dados.items():
        if not v:
            dados[k] = NAO_ENCONTRADO
    return validar(dados)

# ---------------------------------------------------------------------------
# Rota API
# ---------------------------------------------------------------------------

@app.route("/api/gerar", methods=["POST"])
def gerar():
    if "pdf" not in request.files:
        return jsonify({"erro": "Nenhum PDF enviado"}), 400

    arquivo = request.files["pdf"]
    if not arquivo.filename.lower().endswith(".pdf"):
        return jsonify({"erro": "Arquivo deve ser PDF"}), 400

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False, dir="/tmp") as tmp:
        arquivo.save(tmp.name)
        try:
            dados = processar(tmp.name)
        except Exception as e:
            return jsonify({"erro": f"Erro ao processar PDF: {e}"}), 500
        finally:
            os.unlink(tmp.name)

    assunto = ASSUNTO_TEMPLATE.format(**dados)
    corpo = CORPO_TEMPLATE.format(**dados)

    erros    = [k for k, v in dados.items() if ERRO in v]
    pendentes = [k for k, v in dados.items() if "[" in v and k not in erros]

    return jsonify({
        "assunto":   assunto,
        "corpo":     corpo,
        "dados":     dados,
        "erros":     erros,
        "pendentes": pendentes,
    })
