from flask import Flask, request, jsonify
import pdfplumber
import re
import tempfile
import os
from datetime import datetime

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Extração de texto
# ---------------------------------------------------------------------------

def extrair_texto_pdf(path: str) -> str:
    paginas = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                paginas.append(t)
    return "\n".join(paginas)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _primeiro(padrao, texto, flags=re.IGNORECASE):
    m = re.search(padrao, texto, flags)
    return m.group(1).strip() if m else ""

def _todos(padrao, texto, flags=re.IGNORECASE):
    return re.findall(padrao, texto, flags)


# ---------------------------------------------------------------------------
# Extração de campos
# ---------------------------------------------------------------------------

def extrair_razao_social(texto):
    padroes = [
        r"CONTRATANTE[:\s]+([A-ZÁÉÍÓÚÀÂÊÔÃÕÇÜ][A-Za-záéíóúàâêôãõçüÁÉÍÓÚÀÂÊÔÃÕÇÜ\s\-&.,/]+?(?:LTDA|S\.A\.|SA|ME|EPP|EIRELI|S/A)[^\n]*)",
        r"Razão Social[:\s]+([^\n]+)",
        r"(?:empresa|contratante)[:\s]+([A-ZÁÉÍÓÚÀÂÊÔÃÕÇÜ][^\n,;]{5,80}(?:LTDA|S\.A\.|SA|ME|EPP|EIRELI))",
    ]
    for p in padroes:
        v = _primeiro(p, texto)
        if v:
            return v.strip().rstrip(".,;")
    return "[RAZÃO SOCIAL NÃO ENCONTRADA]"


def extrair_cnpj(texto):
    cnpjs = _todos(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}", texto)
    if len(cnpjs) >= 2:
        return cnpjs[1]
    if cnpjs:
        return cnpjs[0]
    return "[CNPJ NÃO ENCONTRADO]"


def extrair_endereco(texto):
    padroes = [
        r"((?:Rua|Avenida|Av\.|Alameda|Al\.|Travessa|Tv\.|Rodovia|Rod\.|Estrada|Praça)[^\n]{10,150}(?:CEP|cep)[:\s]*\d{5}-?\d{3})",
        r"Endereço[:\s]+([^\n]+(?:\n[^\n]+){0,3})",
        r"((?:Rua|Avenida|Av\.)[^\n]+,\s*n[°º]?\s*\d+[^\n]*\d{5}-\d{3})",
    ]
    for p in padroes:
        v = _primeiro(p, texto, re.IGNORECASE | re.DOTALL)
        if v:
            return " ".join(v.split())
    return "[ENDEREÇO NÃO ENCONTRADO]"


def extrair_email_financeiro(texto):
    dominios_iel = {"iel", "senai", "fieg", "sesi", "cni"}

    def externo(email):
        return not any(d in email.split("@")[-1].lower() for d in dominios_iel)

    blocos = re.split(r"(?:Histórico|Log de assinaturas|Clicksign)", texto, flags=re.IGNORECASE)
    if len(blocos) > 1:
        emails = [e for e in _todos(r"[\w.+\-]+@[\w\-]+\.[\w.]+", blocos[-1]) if externo(e)]
        if emails:
            return emails[-1]

    m = re.search(r"CONTRATANTE(.{0,2000}?)(?:CONTRATADA|CLÁUSULA|Cláusula)", texto, re.IGNORECASE | re.DOTALL)
    if m:
        emails = [e for e in _todos(r"[\w.+\-]+@[\w\-]+\.[\w.]+", m.group(1)) if externo(e)]
        if emails:
            return emails[0]

    emails = [e for e in _todos(r"[\w.+\-]+@[\w\-]+\.[\w.]+", texto) if externo(e)]
    return emails[0] if emails else "[EMAIL FINANCEIRO NÃO ENCONTRADO]"


def extrair_valor_total(texto):
    for p in [r"valor total[^\n]*?R\$\s*([\d.,]+)", r"R\$\s*([\d.,]+)"]:
        v = _primeiro(p, texto)
        if v:
            return f"R$ {v}"
    return "[VALOR NÃO ENCONTRADO]"


def extrair_forma_pagamento(texto):
    if re.search(r"cart[aã]o de cr[eé]dito", texto, re.IGNORECASE):
        return "Cartão de crédito"
    if re.search(r"boleto", texto, re.IGNORECASE):
        return "Boleto bancário"
    return "[FORMA DE PAGAMENTO NÃO ENCONTRADA]"


def extrair_parcelamento(texto):
    m = re.search(r"(\d+)\s*(?:\(\w+\)\s*)?(?:parcelas?|x\b)", texto, re.IGNORECASE)
    if m:
        n = int(m.group(1))
        return "À vista" if n == 1 else f"Parcelado em {n}x"
    if re.search(r"\bà vista\b", texto, re.IGNORECASE):
        return "À vista"
    return "[PARCELAMENTO NÃO ENCONTRADO]"


def extrair_data_assinatura(texto):
    for p in [r"[Aa]ssinado\s+em\s+(\d{2}/\d{2}/\d{4})", r"[Dd]ata\s+de\s+assinatura[:\s]+(\d{2}/\d{2}/\d{4})", r"(\d{2}/\d{2}/\d{4})"]:
        v = _primeiro(p, texto)
        if v:
            return v
    return datetime.today().strftime("%d/%m/%Y")


def extrair_primeiro_vencimento(texto):
    for p in [r"primeiro vencimento[^\d]*(\d{2}/\d{2}/\d{4})", r"vencimento[^\d]*(\d{2}/\d{2}/\d{4})"]:
        v = _primeiro(p, texto)
        if v:
            return v
    return "[A CONFIRMAR]"


def extrair_dados(texto):
    return {
        "razao_social":        extrair_razao_social(texto),
        "cnpj":                extrair_cnpj(texto),
        "endereco":            extrair_endereco(texto),
        "email_financeiro":    extrair_email_financeiro(texto),
        "valor_total":         extrair_valor_total(texto),
        "forma_pagamento":     extrair_forma_pagamento(texto),
        "parcelamento":        extrair_parcelamento(texto),
        "data_assinatura":     extrair_data_assinatura(texto),
        "primeiro_vencimento": extrair_primeiro_vencimento(texto),
    }


# ---------------------------------------------------------------------------
# Template
# ---------------------------------------------------------------------------

ASSUNTO = "Faturamento – Logística Reversa | {razao_social} | {data_assinatura}"

CORPO = """Boa tarde, Isadora e Frederico,

Segue abaixo as informações de faturamento referentes à venda do produto Logística Reversa para o cliente identificado abaixo. A oportunidade já foi ganha no Néctar e o status no Integrador consta como "Processado".

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
  * Retorno por e-mail com os itens acima para que possamos dar continuidade ao envio ao cliente.

Atenciosamente,"""


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
            texto = extrair_texto_pdf(tmp.name)
        except Exception as e:
            return jsonify({"erro": f"Erro ao ler PDF: {str(e)}"}), 500
        finally:
            os.unlink(tmp.name)

    if not texto.strip():
        return jsonify({"erro": "PDF sem texto extraível (pode ser escaneado/imagem)"}), 422

    dados = extrair_dados(texto)
    assunto = ASSUNTO.format(**dados)
    corpo = CORPO.format(**dados)

    incompletos = [k for k, v in dados.items() if "[" in v]

    return jsonify({
        "assunto": assunto,
        "corpo": corpo,
        "dados": dados,
        "incompletos": incompletos,
    })
