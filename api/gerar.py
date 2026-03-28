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
DOMINIOS_IGNORADOS = {"fieg.com.br", "ielgoias.com.br", "clicksign.com", "iel.org.br"}
MESES_PT = {
    "janeiro": "01", "fevereiro": "02", "março": "03", "marco": "03",
    "abril": "04", "maio": "05", "junho": "06", "julho": "07",
    "agosto": "08", "setembro": "09", "outubro": "10",
    "novembro": "11", "dezembro": "12",
}
MESES_ABREV = {
    "jan": "01", "fev": "02", "mar": "03", "abr": "04",
    "mai": "05", "jun": "06", "jul": "07", "ago": "08",
    "set": "09", "out": "10", "nov": "11", "dez": "12",
}
ERRO_EXTRACAO = "[ERRO NA EXTRAÇÃO - VERIFICAR]"

# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

ASSUNTO_TEMPLATE = (
    "Faturamento – Logística Reversa | {razao_social} | {data_assinatura}"
)

CORPO_TEMPLATE = """\
Boa tarde, Isadora e Frederico,

Segue abaixo as informações de faturamento referentes à venda do produto
Logística Reversa para o cliente identificado abaixo. A oportunidade já foi
ganha no Néctar e o status no Integrador consta como "Processado".

DADOS DO CLIENTE E FATURAMENTO
  * Razão Social: {razao_social}
  * CNPJ: {cnpj}
  * Endereço: {endereco}
  * E-mail do financeiro: {email_financeiro}

Condições Comerciais
  * Valor total negociado: {valor_total}
  * Forma de pagamento: {forma_pagamento}
  * Condições: {parcelamento}
  * Data do primeiro vencimento: {primeiro_vencimento}

Solicito que, com base nessas informações, seja providenciado:
  * Emissão da Nota Fiscal;
  * Geração do link de pagamento (cartão de crédito) ou emissão do 1º boleto;
  * Retorno por e-mail com os itens acima para que possamos dar continuidade
    ao envio ao cliente.

Atenciosamente,"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _primeiro_match(padrao, texto, flags=re.IGNORECASE):
    m = re.search(padrao, texto, flags)
    return m.group(1).strip() if m else ""


def _email_valido(email):
    dominio = email.split("@")[-1].lower()
    return not any(dominio == d or dominio.endswith("." + d) for d in DOMINIOS_IGNORADOS)


def _data_extenso(texto_data):
    m = re.search(r"(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})", texto_data, re.IGNORECASE)
    if not m:
        return texto_data
    dia, mes_str, ano = m.group(1), m.group(2).lower(), m.group(3)
    mes = MESES_PT.get(mes_str)
    return f"{int(dia):02d}/{mes}/{ano}" if mes else texto_data


def _data_abrev(texto):
    m = re.search(r"(\d{1,2})\s+([a-z]{3})\s+(\d{4})", texto, re.IGNORECASE)
    if m:
        dia, abrev, ano = m.group(1), m.group(2).lower(), m.group(3)
        mes = MESES_ABREV.get(abrev)
        if mes:
            return f"{int(dia):02d}/{mes}/{ano}"
    return ""

# ---------------------------------------------------------------------------
# Extração de texto
# ---------------------------------------------------------------------------

def extrair_texto(path):
    paginas = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            paginas.append(page.extract_text() or "")
    texto = "\n".join(paginas)
    idx = texto.lower().find("clicksign")
    log = texto[idx:] if idx >= 0 else texto[-3000:]
    return texto, log

# ---------------------------------------------------------------------------
# Extração — campo por campo
# ---------------------------------------------------------------------------

def extrair_razao_social(texto):
    v = _primeiro_match(
        r"Raz[aã]o\s+Social:\s*(.+?)(?:\n|CNPJ|CPF)", texto, re.IGNORECASE | re.DOTALL
    )
    if v:
        v = re.split(r"\n|CNPJ|CPF", v)[0].strip().rstrip(".,;:")
        if v and "INSTITUTO EUVALDO LODI" not in v.upper():
            return v

    bloco = _primeiro_match(
        r"CONTRATANTE\b(.{0,800}?)(?:CONTRATADO\b|Cl[aá]usula\s+Primeira)",
        texto, re.IGNORECASE | re.DOTALL
    )
    if bloco:
        for linha in bloco.splitlines():
            linha = linha.strip()
            if re.search(r"(?:LTDA|S\.A\.|EIRELI|ME|EPP|SA\b)", linha, re.IGNORECASE):
                if "INSTITUTO EUVALDO LODI" not in linha.upper():
                    return linha.rstrip(".,;:")
    return ""


def extrair_cnpj(texto):
    for cnpj in re.findall(r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}", texto):
        d = re.sub(r"\D", "", cnpj)
        if len(d) == 14:
            fmt = f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:14]}"
            if fmt != CNPJ_IEL:
                return fmt
    return ""


def extrair_endereco(texto):
    v = _primeiro_match(
        r"Endere[çc]o:\s*(.+?)(?:\n(?:Representante|Cargo|CNPJ|CPF|E-?mail)|$)",
        texto, re.IGNORECASE | re.DOTALL
    )
    return " ".join(v.split()) if v else ""


def extrair_representante(texto):
    v = _primeiro_match(
        r"Representante:\s*(.+?)(?:\n|Cargo|CPF|$)", texto, re.IGNORECASE | re.DOTALL
    )
    return v.split("\n")[0].strip() if v else ""


def extrair_email_financeiro(texto, log):
    m = re.search(
        r"assinou\.\s*Pontos\s+de\s+autentica[çc][aã]o:.*?Token\s+via\s+E-?mail\s+(\S+@\S+\.\S+)",
        log, re.IGNORECASE | re.DOTALL
    )
    if m:
        email = m.group(1).strip().rstrip(".,;)")
        if _email_valido(email):
            return email.lower()

    for email in re.findall(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", log):
        if _email_valido(email):
            return email.lower()

    for email in re.findall(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", texto):
        if _email_valido(email):
            return email.lower()
    return ""


def extrair_valor_total(texto):
    v = _primeiro_match(r"VALOR\s+R\$\s*([\d.,]+)", texto, re.IGNORECASE)
    if v:
        return f"R$ {v}"
    valores = re.findall(r"R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}", texto)
    return valores[-1].strip() if valores else ""


def extrair_forma_pagamento(texto):
    v = _primeiro_match(r"MODALIDADE\s+(Boleto[^\n]*|Cart[aã]o[^\n]*)", texto, re.IGNORECASE)
    if v:
        return "Cartão de crédito" if "cart" in v.lower() else "Boleto bancário"
    if re.search(r"cart[aã]o\s+de\s+cr[eé]dito", texto, re.IGNORECASE):
        return "Cartão de crédito"
    if re.search(r"boleto", texto, re.IGNORECASE):
        return "Boleto bancário"
    return ""


def extrair_parcelamento(texto):
    v = _primeiro_match(r"PARCELAMENTO\s+(\d+x|[Àà]\s*vista[^\n]*)", texto, re.IGNORECASE)
    if v:
        m = re.match(r"(\d+)x", v, re.IGNORECASE)
        if m:
            n = int(m.group(1))
            return "À vista" if n <= 1 else f"Parcelado em {n}x"
        return "À vista"
    m = re.search(r"(\d+)\s*x\b", texto, re.IGNORECASE)
    if m:
        n = int(m.group(1))
        return "À vista" if n <= 1 else f"Parcelado em {n}x"
    if re.search(r"\b[àa]\s*vista\b", texto, re.IGNORECASE):
        return "À vista"
    return ""


def extrair_data_assinatura(texto, log):
    v = _primeiro_match(r"Goi[âa]nia,?\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})", texto, re.IGNORECASE)
    if v:
        d = _data_extenso(v)
        if re.match(r"\d{2}/\d{2}/\d{4}", d):
            return d

    datas_log = re.findall(
        r"\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\s+\d{4}",
        log, re.IGNORECASE
    )
    if datas_log:
        d = _data_abrev(datas_log[-1])
        if d:
            return d

    datas = re.findall(r"\d{2}/\d{2}/\d{4}", texto)
    return datas[0] if datas else datetime.today().strftime("%d/%m/%Y")


def extrair_primeiro_vencimento(texto):
    v = _primeiro_match(
        r"(?:primeiro\s+vencimento|vencimento\s+da\s+primeira\s+parcela|1[°º]\s+vencimento)[:\s]+(\d{2}/\d{2}/\d{4})",
        texto, re.IGNORECASE
    )
    return v if v else "[A CONFIRMAR]"


# ---------------------------------------------------------------------------
# Validação
# ---------------------------------------------------------------------------

def validar(dados):
    if not dados["razao_social"] or "INSTITUTO EUVALDO LODI" in dados["razao_social"].upper():
        dados["razao_social"] = ERRO_EXTRACAO
    cnpj = dados["cnpj"]
    if not re.match(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$", cnpj) or cnpj == CNPJ_IEL:
        dados["cnpj"] = ERRO_EXTRACAO
    email = dados["email_financeiro"]
    if email and not _email_valido(email):
        dados["email_financeiro"] = ERRO_EXTRACAO
    if not re.match(r"R\$\s*\d+.*,\d{2}$", dados["valor_total"]):
        dados["valor_total"] = ERRO_EXTRACAO
    return dados


def extrair_dados(texto, log):
    dados = {
        "razao_social":        extrair_razao_social(texto),
        "cnpj":                extrair_cnpj(texto),
        "endereco":            extrair_endereco(texto),
        "representante":       extrair_representante(texto),
        "email_financeiro":    extrair_email_financeiro(texto, log),
        "valor_total":         extrair_valor_total(texto),
        "forma_pagamento":     extrair_forma_pagamento(texto),
        "parcelamento":        extrair_parcelamento(texto),
        "data_assinatura":     extrair_data_assinatura(texto, log),
        "primeiro_vencimento": extrair_primeiro_vencimento(texto),
    }
    for k, v in dados.items():
        if not v:
            dados[k] = "[NÃO ENCONTRADO]"
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
            texto, log = extrair_texto(tmp.name)
        except Exception as e:
            return jsonify({"erro": f"Erro ao ler PDF: {e}"}), 500
        finally:
            os.unlink(tmp.name)

    if not texto.strip():
        return jsonify({"erro": "PDF sem texto extraível (pode ser escaneado/imagem)"}), 422

    dados = extrair_dados(texto, log)
    assunto = ASSUNTO_TEMPLATE.format(**dados)
    corpo = CORPO_TEMPLATE.format(**dados)

    erros = [k for k, v in dados.items() if ERRO_EXTRACAO in v]
    pendentes = [k for k, v in dados.items() if "[" in v and k not in erros]

    return jsonify({
        "assunto":  assunto,
        "corpo":    corpo,
        "dados":    dados,
        "erros":    erros,
        "pendentes": pendentes,
    })
