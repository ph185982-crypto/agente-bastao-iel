"""Formato "Destrava" (referência: reels no estilo Kallaway que o Pedro mandou em 14/11/2026). Sem IA.

Tela 1080x1920:
  - SPLIT (a maior parte do tempo): fundo quase preto com grade de pontos; em cima, gráficos animados com brilho
    (título com fonte mista, fichas numeradas, cartão de "regra", número gigante, ícone neon, vídeo em moldura brilhante);
    embaixo, o Pedro numa janela de cantos arredondados (x 66, y 1320, 948x600), com o rosto centralizado (o recorte
    segue o rosto quadro a quadro) e a CABEÇA SAINDO pela borda de cima da janela (recorte da pessoa nas 150 linhas
    acima dela: dá profundidade, como na referência). Legenda: UMA palavra por vez, logo acima da cabeça.
  - ROSTO: close do Pedro em tela cheia (a cada ~10 s, frases curtas), rosto no alto e legenda embaixo do queixo.
  - BROLL: cena de banco de imagens em tela cheia (no máximo 1 a cada ~16 s).
  - FIM: na frase de chamada final ("salva…", "comenta…"), tudo escurece, entra a chamada + logo do Instagram + @.
Sem marca d'água lateral: o @ aparece só na tela final (pedido do Pedro em 14/11).
Os textos dos gráficos "acendem" palavra a palavra no tempo da fala (cinza → branco), como na referência.

PLANO VISUAL (15/11): quando o app manda um plano por frase (feito pela IA gratuita, ver backend/lib/videos/plano.js),
cada cena segue o SENTIDO da frase: título que dá nome à ideia, tipo de cena (imagem, número, lista, comparação,
gráfico, cartão, close, cena cheia, ícone) e a busca da imagem em inglês. Sem plano, valem as regras de sempre.
"""
import math
import re

W, H = 1080, 1920
JANELA = {'x': 66, 'y': 1320, 'w': 948, 'h': 600, 'raio': 40}
RECORTE = 150          # linhas acima da janela por onde a cabeça "sai" (só a pessoa aparece ali)
ROSTO_JANELA = 0.46    # centro do rosto a 46% da altura da janela: olhos no terço de cima, queixo dentro, cabelo sai
ROSTO_CLOSE = 760      # no close em tela cheia, centro do rosto em y=760 (legenda cabe embaixo do queixo)
ZOOM_JANELA = 1.06     # folga de 6% para centralizar o rosto na horizontal sem deixá-lo grande demais
ZOOM_CLOSE = 1.22
INSET_IMAGEM = {'x': 120, 'y': 330, 'w': 840, 'h': 740, 'raio': 36}
INSET_TITULO = {'x': 150, 'y': 400, 'w': 780, 'h': 660, 'raio': 36}
Y_LEGENDA = {'split': 1125, 'rosto': 1250, 'broll': 1160, 'fim': 1125}
HANDLE = '@PEDRO_DESTRAVA'


def escala_janela(largura, altura, altura_rosto=None):
    """Escala da fonte para a janela de baixo → (s, largura_escalada, altura_escalada).
    Cobre a janela (a faixa do recorte, acima dela, pode ser preenchimento) com 6% de folga para centralizar; se o
    rosto é pequeno (câmera longe), aproxima até ele ocupar ~62% da altura da janela (no máximo 2,2× a escala base).
    `altura_rosto` = altura do rosto ÷ altura do quadro (mediana do vídeo)."""
    base = max(JANELA['w'] / largura, JANELA['h'] / altura)
    s = base * ZOOM_JANELA
    if altura_rosto:
        s = max(s, min(0.62 * JANELA['h'] / (altura_rosto * altura), base * 2.2))
    return s, int(math.ceil(largura * s / 2) * 2), int(math.ceil(altura * s / 2) * 2)


def escala_close(largura, altura):
    """Escala do close em tela cheia → (s, largura_escalada, altura_escalada): cobre 1080x1920 com zoom de 22%."""
    s = max(W / largura, H / altura) * ZOOM_CLOSE
    return s, int(math.ceil(largura * s / 2) * 2), int(math.ceil(altura * s / 2) * 2)

# cores ASS (&HAABBGGRR)
# CINZA: palavra ainda não falada (dá para ler no celular; antes era escuro demais). CINZA_ROTEIRO: frases vizinhas no cartão.
BRANCO = '&H00FFFFFF&'; CINZA = '&H00908C8A&'; CINZA_LINHA = '&H00403A3A&'; CINZA_ROTEIRO = '&H00706C6A&'; PRETO = '&H00141414&'
AMARELO = '&H0047E0FD&'; LARANJA = '&H004370FF&'; AZUL = '&H00FF6A3D&'; VERDE = '&H005EC522&'; ROXO = '&H00F755A8&'; ROSA = '&H00A23DE1&'
VERMELHO = '&H004848FF&'
ACENTOS = [LARANJA, AZUL, AMARELO, VERDE, ROXO]

STOP = set('''a o e é de da do das dos em no na nos nas um uma uns umas que se não sim eu tu ele ela nós eles elas meu minha
seu sua seus suas nosso nossa isso isto aquilo esse essa este esta aquele aquela para pra por pelo pela com sem mais menos
muito muita muitos muitas pouco já também só ainda quando onde como porque qual quais quem lhe me te ao aos à às ou mas
então tá né vai vou foi ser ter tem era está estão estava você vocês dela dele deles delas há até sobre entre depois antes
cada todo toda todos todas outro outra mesmo mesma coisa coisas fazer faz fez qualquer'''.split())
NEGOCIO = r'dinheir|marca|client|preç|lucr|investi|empres|negóci|negoci|venda|produto|imposto|caixa|loja|custo|margem|salári|dívida|crédito|juros|sucesso|qualidade|estratég|foco|resultado|milh|bilh|cresc|gigant|riqueza|liberdade|governo|taxa|multa|lição|segredo|estoque|sócio|socio|fundo|anúnci|anunci|venda'
VERBO = r'(ar|er|ir|ou|eu|iu|ava|ando|endo|indo|ado|ido|aram|eram|iram|amos|emos|imos)$'
# chamada final: verbos de ação com o objeto típico ("quem MANDA no estoque" e "SEGUE o lucro" não são chamada)
CTA = re.compile(r'\b(salva|salve|comenta|comente|compartilha|compartilhe|link na bio|marca (algu[eé]m|um amigo|uma amiga|quem)|marque|me segue|me siga|segue (o|meu) perfil|siga (o|meu) perfil|(manda|mande|envia|envie) (esse|este|isso|pra|para|pro|pros|pras))\b', re.I)
CONTAGEM = re.compile(r'\b(duas|dois|tr[eê]s|quatro|cinco|[2-5])\s+(coisas|passos|erros|dicas|regras|pilares|segredos|motivos|formas|maneiras|pontos|li[cç][oõ]es|h[aá]bitos)\b', re.I)
NUM_EXT = {'duas': 2, 'dois': 2, 'três': 3, 'tres': 3, 'quatro': 4, 'cinco': 5}
REGRA = re.compile(r'\b(quem|segredo|regra|li[cç][aã]o|nunca|sempre|manda|verdade|liberdade|garante)\b', re.I)
ICONES = [
    ('dinheiro', r'r\$|dinheir|investi|preç|pagar|pagava|lucr|fatur|milh|bilh|caixa|fundo'),
    ('seta', r'cresc|aument|gigant|maior|escal|explod|dobr|ganh|sucesso|marca'),
    ('x', r'\bnão\b|\bnunca\b|\bsem\b|erro|errad|perd|quebr|prejuízo|cuidado|problema|pior'),
    ('alvo', r'\bfoco|focou|focar|objetivo|meta\b|estratég|plano'),
    ('lampada', r'ideia|lição|licao|segredo|aprend|descobr|entend|dica'),
    ('check', r'prov|certo|funcion|consegu|garant|verdade'),
    ('relogio', r'tempo|hora|minuto|\bdias?\b|\banos?\b|rápido|prazo'),
    ('cadeado', r'liberdade|seguran|proteg|controle|indepen'),
    ('pessoa', r'client|pessoa|equipe|\btime\b|sóci|funcion|público'),
]
ICONES_NOMES = ('dinheiro', 'seta', 'x', 'alvo', 'lampada', 'check', 'relogio', 'estrela', 'pergunta', 'cadeado', 'pessoa', 'grafico')
# item de lista anunciado e explicado ao longo do vídeo ("O primeiro erro é…", "O segundo…", "Por último…")
ORDINAL = re.compile(r'^\W*(?:e\s+)?(?:o\s+|a\s+)?(primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|quint[oa]|por último|por fim|últim[oa])\b', re.I)
NOMES_ITEM = r'(?:erro|passo|dica|ponto|segredo|coisa|regra|pilar|motivo|h[aá]bito|li[cç][aã]o|forma|maneira|item)'
ROTULOS_CARTAO = ('LIÇÃO', 'REGRA', 'VERDADE', 'ERRO', 'SEGREDO', 'DICA')
# ícones neon (contorno), caixa 240x240
DESENHOS = {
    'seta': 'm 120 0 l 240 130 l 165 130 l 165 240 l 75 240 l 75 130 l 0 130',
    'x': 'm 30 0 l 120 90 l 210 0 l 240 30 l 150 120 l 240 210 l 210 240 l 120 150 l 30 240 l 0 210 l 90 120 l 0 30',
    'check': 'm 0 130 l 40 90 l 95 145 l 200 20 l 240 60 l 95 225',
    'alvo': 'm 120 0 b 186 0 240 54 240 120 b 240 186 186 240 120 240 b 54 240 0 186 0 120 b 0 54 54 0 120 0 m 120 60 b 87 60 60 87 60 120 b 60 153 87 180 120 180 b 153 180 180 153 180 120 b 180 87 153 60 120 60',
    'lampada': 'm 120 0 b 190 0 240 50 240 115 b 240 160 215 185 190 205 l 190 240 l 50 240 l 50 205 b 25 185 0 160 0 115 b 0 50 50 0 120 0',
    'relogio': 'm 120 0 b 186 0 240 54 240 120 b 240 186 186 240 120 240 b 54 240 0 186 0 120 b 0 54 54 0 120 0 m 112 40 l 128 40 l 128 115 l 180 148 l 172 162 l 112 124',
    'estrela': 'm 120 0 l 150 85 l 240 88 l 168 142 l 195 230 l 120 178 l 45 230 l 72 142 l 0 88 l 90 85',
    'cadeado': 'm 55 112 l 55 75 b 55 30 85 0 120 0 b 155 0 185 30 185 75 l 185 112 l 160 112 l 160 75 b 160 45 145 25 120 25 b 95 25 80 45 80 75 l 80 112 m 25 112 l 215 112 l 215 240 l 25 240',
    'pessoa': 'm 120 0 b 152 0 178 26 178 58 b 178 90 152 116 120 116 b 88 116 62 90 62 58 b 62 26 88 0 120 0 m 15 240 b 15 168 62 135 120 135 b 178 135 225 168 225 240',
    'grafico': 'm 20 160 l 70 160 l 70 240 l 20 240 m 95 100 l 145 100 l 145 240 l 95 240 m 170 30 l 220 30 l 220 240 l 170 240',
}


# ── Utilidades ────────────────────────────────────────────────────────────────────────────────────────────────────
def t_ass(s):
    s = max(0.0, float(s)); h = int(s // 3600); m = int(s % 3600 // 60)
    return f"{h}:{m:02d}:{s % 60:05.2f}"


def esc(s):
    return (s or '').replace('\\', '').replace('{', '(').replace('}', ')').replace('\n', ' ')


def limpa(w):
    return re.sub(r'[^\wÀ-ÿ$%]', '', w or '', flags=re.U)


def palavra_chave(texto):
    t = texto or ''
    proporcao = re.search(r'(\d+)\s+(?:em cada|de cada|a cada|em|de)\s+(\d+)', t)
    if proporcao:
        return f"{proporcao.group(1)} em {proporcao.group(2)}"
    num = re.search(r'R\$\s?[\d.,]+(?:\s?(?:mil|milhões|milhão|bi))?|\d+[\d.,]*\s?%|\d+[\d.,]*', t)
    if num:
        return num.group(0).strip()
    pal = [limpa(w) for w in t.split()]
    cand = [w for w in pal if len(w) >= 4 and w.lower() not in STOP and not re.search(VERBO, w.lower())] or \
           [w for w in pal if len(w) >= 4 and w.lower() not in STOP]
    if not cand:
        return ''
    melhor = max(cand, key=lambda w: (2 if re.search(NEGOCIO, w.lower()) else 0) + min(len(w), 12) / 12)
    return melhor[:1].upper() + melhor[1:].lower()


def icone(texto):
    t = (texto or '').lower()
    if '?' in t:
        return 'pergunta'
    for nome, rx in ICONES:
        if re.search(rx, t):
            return nome
    return 'estrela'


def quebrar(texto, fs, largura, fator=0.56):
    """Quebra por palavras pela largura estimada (libass não quebra igual em eventos diferentes; aqui fica fixo)."""
    linhas, atual = [], ''
    for w in (texto or '').split():
        teste = f"{atual} {w}".strip()
        if atual and len(teste) * fs * fator > largura:
            linhas.append(atual); atual = w
        else:
            atual = teste
    if atual:
        linhas.append(atual)
    return linhas


def caixa_arredondada(x, y, w, h, r):
    """Desenho ASS de retângulo de cantos arredondados (coordenadas absolutas, para usar com \\pos(0,0))."""
    k = 0.5523 * r
    return (f"m {x + r} {y} l {x + w - r} {y} b {x + w - r + k} {y} {x + w} {y + r - k} {x + w} {y + r} "
            f"l {x + w} {y + h - r} b {x + w} {y + h - r + k} {x + w - r + k} {y + h} {x + w - r} {y + h} "
            f"l {x + r} {y + h} b {x + r - k} {y + h} {x} {y + h - r + k} {x} {y + h - r} "
            f"l {x} {y + r} b {x} {y + r - k} {x + r - k} {y} {x + r} {y}")


def circulo(cx, cy, r):
    k = 0.5523 * r
    return (f"m {cx} {cy - r} b {cx + k} {cy - r} {cx + r} {cy - k} {cx + r} {cy} b {cx + r} {cy + k} {cx + k} {cy + r} {cx} {cy + r} "
            f"b {cx - k} {cy + r} {cx - r} {cy + k} {cx - r} {cy} b {cx - r} {cy - k} {cx - k} {cy - r} {cx} {cy - r}")


# ── Plano ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def _txt(s, n):
    return re.sub(r'\s+', ' ', str(s or '')).strip()[:n]


def _norm(s):
    return re.sub(r'[^\wÀ-ÿ]+', ' ', str(s or '').lower()).strip()


def _partir(f, maximo=5.0):
    pal = f.get('palavras') or []
    if f['n1'] - f['n0'] <= maximo or len(pal) < 6:
        return [f]
    # parte na pontuação mais perto do meio; sem pontuação, na palavra do meio
    alvo = (f['n0'] + f['n1']) / 2
    cand = [i for i in range(2, len(pal) - 2) if re.search(r'[,.;:!?]$', pal[i - 1]['w'])] or list(range(2, len(pal) - 2))
    k = min(cand, key=lambda i: abs(pal[i]['n0'] - alvo))
    plano = f.get('plano')
    a = {'n0': f['n0'], 'n1': pal[k]['n0'], 'palavras': pal[:k], 'plano': plano}
    b = {'n0': pal[k]['n0'], 'n1': f['n1'], 'palavras': pal[k:], 'plano': dict(plano, continua=True) if plano else None}
    for x in (a, b):
        x['texto'] = ' '.join(p['w'] for p in x['palavras'])
    return _partir(a, maximo) + _partir(b, maximo)


def itens_da_lista(texto, n):
    """'…: produto com acabamento impecável e preço que a cliente consegue pagar' → ['produto com acabamento impecável', 'preço que…']."""
    t = texto.split(':', 1)[1] if ':' in texto else texto
    partes = [_sem_conjuncao(p.strip(' .,;')) for p in re.split(r',\s*|\s+e\s+(?=\w)', t) if p.strip(' .,;')]
    partes = [p for p in partes if len(p.split()) >= 2]
    return partes[:n] if len(partes) >= 2 else []


def _sem_conjuncao(t):
    t = re.sub(r'^(e|mas|ou|então|e o|e a)\s+', '', (t or '').strip(), flags=re.I).strip(' .,;')
    return t[:1].upper() + t[1:] if t else t


def frases_por_pontuacao(palavras, maximo=6.0):
    """Palavras (n0/n1/w) → frases inteiras, cortando no ponto final/interrogação/exclamação (o Whisper agrupa errado)."""
    frases, atual = [], []
    for p in palavras:
        atual.append(p)
        fim = re.search(r'[.!?]$', p['w']) or (p['n1'] - atual[0]['n0'] > maximo * 1.6 and re.search(r'[,;:]$', p['w']))
        if fim:
            frases.append(atual); atual = []
    if atual:
        frases.append(atual)
    return [{'n0': f[0]['n0'], 'n1': f[-1]['n1'], 'palavras': f, 'texto': ' '.join(x['w'] for x in f)} for f in frases if f]


def _instante_de(rotulo, pal, padrao):
    """Quando o rótulo (item da lista, lado da comparação) começa a ser falado: 1ª palavra de conteúdo dele na fala."""
    alvo = [limpa(w).lower() for w in (rotulo or '').split() if len(limpa(w)) >= 4 and limpa(w).lower() not in STOP]
    for w in alvo[:3]:
        for p in pal:
            if limpa(p['w']).lower() == w:
                return p['n0']
    return padrao


def rotulo_ordinal(texto, maximo=6):
    """'O primeiro erro é misturar as contas.' → 'Misturar as contas' (o que vem depois do marcador)."""
    t = ORDINAL.sub('', texto or '', count=1)
    t = re.sub(rf'^\s*{NOMES_ITEM}?\s*(?:é|foi|:|,|-|–)?\s*', '', t, flags=re.I).strip(' .,:;!?')
    w = t.split()
    return _sem_conjuncao(' '.join(w[:maximo]) + ('…' if len(w) > maximo else '')) if w else ''


def planejar(frases, duracao, titulo='', broll=True, plano=None, gancho=''):
    """frases [{n0,n1,texto,palavras:[{n0,n1,w}]}] (tempo final) → blocos contíguos com layout e gráfico.
    `plano` (opcional): uma cena por frase, na mesma ordem ({tipo, titulo, busca, rotulo, destaque, itens, esquerda,
    direita, direcao, icone, pessoa, texto}); o que o plano pede só entra se couber nas regras de tempo do formato.
    `gancho` (opcional): 3–5 palavras que abrem o vídeo grandes, palavra a palavra, antes do título."""
    duracao = float(duracao)
    frases = sorted(frases, key=lambda f: f['n0'])
    if plano:
        frases = [dict(f, plano=plano[i] if i < len(plano) and isinstance(plano[i], dict) else None) for i, f in enumerate(frases)]
    partes = []
    for f in frases:
        partes += _partir(f)
    juntas = []
    for x in partes:
        if juntas and (x['n1'] - x['n0'] < 1.0):
            j = juntas[-1]
            juntas[-1] = {'n0': j['n0'], 'n1': x['n1'], 'texto': f"{j['texto']} {x['texto']}", 'palavras': j['palavras'] + x['palavras'],
                          'plano': j.get('plano') or x.get('plano')}
        else:
            juntas.append(dict(x))
    if not juntas:
        return [{'t0': 0.0, 't1': duracao, 'layout': 'split', 'tipo': 'titulo', 'titulo': titulo or '', 'texto': '', 'palavras': [], 'acento': LARANJA, 'marcas': []}]
    blocos = []
    ultimo_rosto, ultimo_broll, alterna, lista_pendente = 0.0, -99.0, 0, None
    cabecas = set()
    n = len(juntas)
    for i, x in enumerate(juntas):
        t0 = 0.0 if i == 0 else round(x['n0'], 3)
        t1 = duracao if i == n - 1 else round(juntas[i + 1]['n0'], 3)
        texto = x['texto']; dur = t1 - t0
        p = dict(x.get('plano') or {})
        cont = bool(p.get('continua'))
        pt = '' if cont else str(p.get('tipo') or '')
        b = {'t0': t0, 't1': t1, 'texto': texto, 'palavras': x['palavras'], 'chave': palavra_chave(texto), 'icone': icone(texto),
             'acento': ACENTOS[i % len(ACENTOS)], 'layout': 'split'}
        if not cont:
            cab = _txt(p.get('titulo'), 28)
            if cab and _norm(cab) not in cabecas:
                b['cabeca'] = cab
            rot = _txt(p.get('rotulo'), 24)
            if rot and _norm(rot) not in (_norm(cab), _norm(b['chave'])):
                b['rotulo'] = rot
            if p.get('icone') in ICONES_NOMES:
                b['icone'] = p['icone']
        if p.get('busca'):
            b['busca'] = _txt(p['busca'], 60)
        m = CONTAGEM.search(texto)
        itens_plano = [_txt(s, 40) for s in (p.get('itens') or []) if _txt(s, 40)][:4] if pt == 'lista' else []
        prev_split = bool(blocos) and blocos[-1]['layout'] == 'split'
        if pt:   # o plano escolheu pelo sentido: as janelas de tempo ficam um pouco mais folgadas
            pode_rosto = t0 - ultimo_rosto >= 6.0 and 1.0 <= dur <= 5.0 and i > 1
            pode_broll = broll and bool(b.get('busca')) and t0 - ultimo_broll >= 12.0 and 1.5 <= dur <= 4.5 and i > 1 and prev_split
        else:
            pode_rosto = t0 - ultimo_rosto >= 8.0 and 1.3 <= dur <= 4.2 and i > 1
            pode_broll = broll and t0 - ultimo_broll >= 16.0 and 1.5 <= dur <= 3.6 and i > 2 and prev_split
        if i == 0:
            b.update(tipo='titulo', titulo=titulo or texto)
            g_txt = _txt(gancho, 40)
            if g_txt and t1 - t0 >= 2.0:   # gancho grande palavra a palavra; depois entram o título e a imagem
                b.update(gancho=g_txt, gancho_fim=round(min(t0 + 2.4, t0 + (t1 - t0) * 0.55), 3))
                b['inset_ini'] = b['gancho_fim']
        elif i == n - 1 and (CTA.search(texto) or pt == 'fim'):
            b.update(layout='fim', tipo='fim')
        elif lista_pendente and len(lista_pendente['itens']) < lista_pendente['n'] and (not lista_pendente.get('ordinais') or ORDINAL.match(texto)):
            if lista_pendente.get('ordinais'):   # "O segundo erro é…": o item é o que vem depois do marcador (ou o título do plano)
                itens = [b.get('cabeca') or rotulo_ordinal(texto) or _sem_conjuncao(texto)]
            else:
                itens = itens_da_lista(texto, lista_pendente['n'] - len(lista_pendente['itens'])) or [_sem_conjuncao(texto)]
            b.update(tipo='lista', lista=lista_pendente, itens_novos=list(itens), ja=list(lista_pendente['itens']), ordinal=bool(lista_pendente.get('ordinais')))
            lista_pendente['itens'] = lista_pendente['itens'] + list(itens)
        elif m:
            g = m.group(1).lower()
            nl = max(2, min(4, int(g) if g.isdigit() else NUM_EXT.get(g, 2)))
            lista = {'n': nl, 'titulo': b.get('cabeca') or f"{m.group(1).capitalize()} {m.group(2).lower()}", 'itens': []}
            if len(itens_plano) >= 2:      # rótulos curtos do plano ("Acabamento impecável") no lugar da frase falada inteira
                lista['rotulos'] = list(itens_plano)
            itens = itens_da_lista(texto, nl) if ':' in texto else []
            lista['itens'] = list(itens)            # cópias: a lista cresce nos blocos seguintes sem mexer neste
            # itens explicados ao longo do vídeo ("O primeiro…", "O segundo…"): o resumo se monta a cada marcador
            lista['ordinais'] = not itens and sum(1 for j in juntas[i + 1:] if ORDINAL.match(j['texto'])) >= 2
            b.update(tipo='lista', lista=lista, itens_novos=list(itens), ja=[])
            lista_pendente = lista if len(itens) < nl else None
        elif len(itens_plano) >= 2:
            lista = {'n': len(itens_plano), 'titulo': b.get('cabeca') or 'Em resumo', 'itens': list(itens_plano)}
            b.update(tipo='lista', lista=lista, itens_novos=list(itens_plano), ja=[], itens_do_plano=True)
        elif pt == 'rosto' and pode_rosto:
            b.update(layout='rosto', tipo='rosto'); ultimo_rosto = t1
        elif pt == 'broll' and pode_broll:
            b.update(layout='broll', tipo='broll'); ultimo_broll = t1
        elif pt == 'numero' and re.search(r'\d', p.get('destaque') or ''):
            b.update(tipo='numero', destaque=_txt(p['destaque'], 16))
        elif pt == 'comparacao' and _txt(p.get('esquerda'), 28) and _txt(p.get('direita'), 28):
            b.update(tipo='comparacao', esquerda=_txt(p['esquerda'], 28), direita=_txt(p['direita'], 28))
        elif pt == 'grafico' and p.get('direcao') in ('sobe', 'desce'):
            b.update(tipo='grafico', direcao=p['direcao'])
        elif pt == 'frase' and len(texto.split()) <= 24:
            r = _txt(p.get('rotulo'), 12).upper()
            b.update(tipo='frase', rotulo_cartao=r if r in ROTULOS_CARTAO else None); b.pop('rotulo', None)
        elif pt == 'pessoa' and _txt(p.get('pessoa'), 60):
            b.update(tipo='foto', pessoa=_txt(p['pessoa'], 60))
        elif pt == 'celular':
            b.update(tipo='celular', busca_tela=_txt(p.get('texto') or b.get('cabeca') or texto, 40))
        elif pt == 'imagem' and broll and b.get('busca'):
            b.update(tipo='imagem'); alterna += 1
        elif pt == 'icone':
            b.update(tipo='icone')
        elif not pt and pode_rosto:     # sem plano: as regras de antes
            b.update(layout='rosto', tipo='rosto'); ultimo_rosto = t1
        elif not pt and pode_broll:
            b.update(layout='broll', tipo='broll'); ultimo_broll = t1
        elif re.search(r'\d', texto):
            b.update(tipo='numero')
        elif REGRA.search(texto) and len(texto.split()) <= 14:
            b.update(tipo='frase')
        else:
            b.update(tipo=('imagem' if (broll and alterna % 2 == 0) else 'icone')); alterna += 1
        if b['tipo'] != 'lista' and not (lista_pendente and lista_pendente.get('ordinais')):
            lista_pendente = None if b['tipo'] not in ('rosto',) else lista_pendente
        if b.get('cabeca'):
            cabecas.add(_norm(b['cabeca']))
        blocos.append(b)
    # cartão de roteiro: a frase de antes e a de depois (texto real, apagado), como o "SCRIPT" da referência
    for k, b in enumerate(blocos):
        if b['tipo'] == 'frase':
            b['antes'] = blocos[k - 1]['texto'] if k > 0 else ''
            b['depois'] = blocos[k + 1]['texto'] if k + 1 < len(blocos) and blocos[k + 1]['tipo'] != 'fim' else ''
    # sem chamada no fim: os últimos 1,6 s viram a tela final e o bloco anterior TERMINA antes (nada fica por baixo dela)
    if blocos and blocos[-1]['layout'] != 'fim' and duracao > 8:
        u = blocos[-1]
        ini = round(max(u['t0'] + 0.8, duracao - 1.6), 3)
        if ini < duracao - 0.5:
            u['t1'] = ini
            blocos.append({'t0': ini, 't1': duracao, 'texto': '', 'palavras': [], 'layout': 'fim', 'tipo': 'fim', 'sem_chamada': True,
                           'acento': ROSA, 'chave': '', 'icone': 'estrela'})
    for b in blocos:
        b['marcas'] = _marcas(b)
    return blocos


def _marcas(b):
    """Instantes em que algo ENTRA dentro do bloco (item da lista, lado da comparação, número...): o gráfico usa para
    acender e o som para o 'pop'. Lista de (t, tipo de som)."""
    a, z, tipo = b['t0'], b['t1'], b['tipo']
    pal = b.get('palavras') or []
    out = []
    if tipo == 'lista':
        novos = b.get('itens_novos') or []
        tempos = []
        for j, item in enumerate(novos):
            padrao = a + (z - a) * (j + 0.3) / max(1, len(novos)) if b.get('itens_do_plano') else a
            ws = [] if b.get('itens_do_plano') else _palavras_do_item(item, pal)
            t = ws[0]['n0'] if ws else _instante_de(item, pal, padrao) if b.get('itens_do_plano') else padrao
            tempos.append(round(max(a, min(z - 0.2, t - 0.05)), 3))
        b['tempos_itens'] = tempos
        out += [(t, 'pop') for t in tempos]
    elif tipo == 'comparacao':
        t_dir = _instante_de(b.get('direita'), pal, a + (z - a) * 0.5)
        # o lado certo entra quando é falado, mas no máximo a 60% da cena: os dois lados ficam juntos na tela
        t_dir = round(max(a + 0.6, min(z - 0.3, a + (z - a) * 0.6, t_dir - 0.05)), 3)
        b['tempos_itens'] = [round(a + 0.1, 3), t_dir]
        out += [(a + 0.15, 'pop'), (t_dir, 'pop')]
    elif tipo == 'numero':
        out.append((a + 0.05, 'impacto'))
    elif tipo in ('frase', 'icone', 'grafico'):
        out.append((a + 0.12, 'pop'))
    elif tipo == 'imagem' and b.get('rotulo'):
        out.append((a + 0.3, 'pop'))
    elif tipo in ('foto', 'celular'):
        out.append((a + 0.3, 'pop'))
    if tipo == 'titulo' and b.get('gancho'):
        out += [(round(a + 0.05 + k * PASSO_GANCHO, 3), 'impacto' if k == 0 else 'pop') for k in range(len(_linhas_gancho(b['gancho'])))]
        out.append((b['gancho_fim'], 'whoosh'))
    return out


PASSO_GANCHO = 0.3   # uma linha do gancho a cada 0,3 s


def _linhas_gancho(texto):
    """Gancho em linhas de UMA palavra, bem grandes (só artigo/preposição de 1–2 letras — 'de', 'o' — vai com a seguinte)."""
    ws = (texto or '').split()
    linhas, buf = [], []
    for k, w in enumerate(ws):
        buf.append(w)
        if len(limpa(w)) > 2 or k == len(ws) - 1:
            linhas.append(' '.join(buf)); buf = []
    if buf:
        linhas.append(' '.join(buf))
    return linhas[:5]


def precisa_broll(blocos):
    """Blocos que pedem vídeo de banco: inset (título/imagem) ou tela cheia (broll)."""
    return [b for b in blocos if b['tipo'] in ('titulo', 'imagem', 'broll')]


def sem_broll(b):
    """Quando o banco de imagens não devolveu nada para o bloco."""
    if b['tipo'] == 'imagem':
        b['tipo'] = 'icone'; b.pop('rotulo', None); b['marcas'] = _marcas(b)
    elif b['tipo'] == 'broll':
        b['layout'] = 'rosto'; b['tipo'] = 'rosto'
    elif b['tipo'] == 'titulo':
        b['sem_inset'] = True


def sem_foto(b):
    """Foto livre da pessoa/marca não achada: vídeo de banco se o plano trouxe busca; senão, ícone."""
    b['tipo'] = 'imagem' if b.get('busca') else 'icone'
    b['marcas'] = _marcas(b)


def bloco_em(blocos, t):
    for b in blocos:
        if b['t0'] <= t < b['t1']:
            return b
    return blocos[-1] if blocos else None


def zoom_da_cena(blocos, t, base=1.0):
    """Zoom do rosto na janela: mais perto no gancho e nas frases de ênfase (cartão de lição, número gigante)."""
    b = bloco_em(blocos, t)
    if not b:
        return base
    if b['tipo'] == 'titulo' and b.get('gancho') and t < b.get('gancho_fim', 0):
        return 1.14
    if b['tipo'] in ('frase', 'numero'):
        return 1.10
    return base


def layout_em(blocos, t):
    for b in blocos:
        if b['t0'] <= t < b['t1']:
            return b['layout']
    return blocos[-1]['layout'] if blocos else 'split'


def efeitos(blocos):
    """Sons curtos (gerados no editor, sem arquivo de terceiros): whoosh na troca de cena, 'pop' quando um elemento entra,
    'impacto' no número gigante e na abertura. Dois sons a menos de 0,25 s: fica o mais forte."""
    forca = {'impacto': 3, 'whoosh': 2, 'pop': 1}
    ev = [(0.05, 'impacto')] if blocos else []
    ev += [(b['t0'], 'whoosh') for i, b in enumerate(blocos) if i and (b['layout'] != blocos[i - 1]['layout'] or b['tipo'] != blocos[i - 1]['tipo'])]
    for b in blocos:
        ev += list(b.get('marcas') or [])
    out = []
    for t, k in sorted(ev):
        if out and t - out[-1][0] < 0.25:
            if forca[k] > forca[out[-1][1]]:
                out[-1] = (out[-1][0], k)
            continue
        out.append((round(t, 3), k))
    return out


# ── ASS ───────────────────────────────────────────────────────────────────────────────────────────────────────────
def cabecalho():
    return ("[Script Info]\nScriptType: v4.00+\n"
            f"PlayResX: {W}\nPlayResY: {H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\n\n"
            "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
            "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            "Style: Sans,Inter,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n"
            "Style: Titulo,Inter Tight,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n"
            "Style: Serif,Instrument Serif,100,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,-1,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n"
            "Style: Grosso,Inter Tight,300,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n"
            "Style: Forma,Inter,20,&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n"
            "Style: Legenda,Inter,70,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,-1,0,0,0,100,100,0,0,1,0,3,5,0,0,0,1\n\n"
            "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")


def _dlg(camada, a, z, estilo, texto):
    return f"Dialogue: {camada},{t_ass(a)},{t_ass(z)},{estilo},,0,0,0,,{texto}"


ENTRA = '\\blur16\\alpha&HFF&\\t(0,320,\\blur0\\alpha&H00&)'   # entrada com desfoque (como na referência)


def _ms(s):
    return int(max(0.0, s) * 1000)


def _pulso(dur, de='&H60&', para='&HB0&', passo=0.9, inicio=0.7):
    """Brilho que pulsa até o fim do bloco (\\t encadeados no alfa do contorno): a cena nunca fica parada."""
    out, t, alt = [], inicio, False
    while t + passo <= dur and len(out) < 14:
        out.append(f"\\t({_ms(t)},{_ms(t + passo)},\\3a{de if alt else para})")
        t += passo; alt = not alt
    return ''.join(out)


def _forma(a, z, desenho, cor, camada=2, glow=True, contorno=0, extra=''):
    """Forma vetorial em coordenadas absolutas; glow = cópia desfocada embaixo."""
    out = []
    if glow:
        if contorno:
            out.append(_dlg(camada - 1, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\1a&HFF&\\3c{cor}\\bord{contorno * 3}\\blur18\\3a&H70&{extra}\\p1}}{desenho}{{\\p0}}"))
        else:
            out.append(_dlg(camada - 1, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{cor}\\bord0\\blur22\\1a&H80&{extra}\\p1}}{desenho}{{\\p0}}"))
    if contorno:
        out.append(_dlg(camada, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\1a&HFF&\\3c{cor}\\bord{contorno}{extra}\\p1}}{desenho}{{\\p0}}"))
    else:
        out.append(_dlg(camada, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{cor}\\bord0{extra}\\p1}}{desenho}{{\\p0}}"))
    return out


def _karaoke(b, a, z, x, y, fs, largura, estilo='Sans', palavras=None, alinhamento=5, negrito=True):
    """Texto que acende no tempo da fala: cinza → branco palavra a palavra. Linhas fixas (mesma quebra em todo evento)."""
    pal = palavras if palavras is not None else b.get('palavras') or []
    if not pal:
        return []
    linhas = quebrar(' '.join(p['w'] for p in pal), fs, largura)
    # índice global de cada palavra por linha
    idx, mapa = 0, []
    for ln in linhas:
        n = len(ln.split()); mapa.append(list(range(idx, idx + n))); idx += n
    out = []
    marcos = [a] + [max(a, min(z, p['n0'])) for p in pal[1:]]
    for k in range(len(pal)):
        ini = marcos[k] if k else a; fim = marcos[k + 1] if k + 1 < len(pal) else z
        if fim - ini < 0.02:
            continue
        partes = []
        for ln in mapa:
            ws = []
            for j in ln:
                cor = BRANCO if j <= k else CINZA
                ws.append(f"{{\\c{cor}}}{esc(pal[j]['w'])}")
            partes.append(' '.join(ws))
        b_tag = '' if negrito else '\\b0'
        out.append(_dlg(3, ini, fim, estilo, f"{{\\an{alinhamento}\\pos({x},{y})\\fs{fs}{b_tag}}}" + '\\N'.join(partes)))
    return out


def _fs_texto(texto, base=56):
    """Tamanho do texto corrido pelo comprimento: frase longa diminui para não invadir a figura."""
    n = len(texto or '')
    return base if n <= 70 else int(base * 0.88) if n <= 110 else int(base * 0.78)


def _titulo_secao(b, a, z, texto, y=170, fs=84):
    """Título da cena (nome da ideia), forte, sobe um pouco ao entrar."""
    if not texto:
        return []
    fs = fs if len(texto) <= 16 else 72 if len(texto) <= 22 else 62
    return [_dlg(3, a, z, 'Titulo', f"{{\\an5\\move({W // 2},{y + 18},{W // 2},{y},0,320)\\fs{fs}{ENTRA}}}{esc(texto)}")]


def _icone(b, a, z, cx, cy, tam=2.1):
    """Ícone neon grande: desenha-se em 0,5 s, cresce devagar e o brilho pulsa até o fim da cena."""
    ic = b.get('icone') or 'estrela'; cor = b['acento']; dur = z - a
    cresce = f"\\t(600,{_ms(dur)},\\fscx{int(tam * 105)}\\fscy{int(tam * 105)})"
    if ic in ('dinheiro', 'pergunta'):
        txt = 'R$' if ic == 'dinheiro' else '?'
        fs = int(220 * tam / 1.5)
        cresce_t = f"\\t(600,{_ms(dur)},\\fscx105\\fscy105)"
        return [_dlg(1, a, z, 'Sans', f"{{\\an5\\pos({cx},{cy})\\fs{fs}\\1a&HFF&\\3c{cor}\\bord16\\blur22\\3a&H60&{cresce_t}{_pulso(dur)}}}{txt}"),
                _dlg(2, a, z, 'Sans', f"{{\\an5\\pos({cx},{cy})\\fs{fs}\\1a&HFF&\\3c{cor}\\bord6{ENTRA}{cresce_t}}}{txt}")]
    s = int(240 * tam); x0, y0 = cx - s // 2, cy - s // 2
    escala = f"\\fscx{int(tam * 100)}\\fscy{int(tam * 100)}"
    d = DESENHOS.get(ic, DESENHOS['estrela'])
    clip = f"\\clip({x0 - 40},{y0 - 40},{x0 - 40},{y0 + s + 40})\\t(0,500,\\clip({x0 - 40},{y0 - 40},{x0 + s + 40},{y0 + s + 40}))"
    return [_dlg(1, a, z, 'Forma', f"{{\\an5\\pos({cx},{cy}){escala}\\1a&HFF&\\3c{cor}\\bord14\\blur20\\3a&H60&{clip}{cresce}{_pulso(dur)}\\p1}}{d}{{\\p0}}"),
            _dlg(2, a, z, 'Forma', f"{{\\an5\\pos({cx},{cy}){escala}\\1a&HFF&\\3c{cor}\\bord6{clip}{cresce}\\p1}}{d}{{\\p0}}")]


def _ficha_desenho(a, z, cx, cy, n, cor, r, apagada):
    """Ficha de cassino numerada (como as fichas douradas da referência). Apagada = ainda não chegou a vez dela."""
    a3 = '\\3a&HB4&' if apagada else ''
    a1 = '\\1a&HB4&' if apagada else ''
    entra = '' if apagada else '\\fad(90,0)'
    out = _forma(a, z, circulo(cx, cy, r), cor, camada=2, contorno=7, glow=not apagada, extra=a3 + entra)
    out += _forma(a, z, circulo(cx, cy, r - 22), cor, camada=2, glow=False, contorno=3, extra=a3 + entra)
    for ang in range(0, 360, 45):   # entalhes da borda
        px, py = cx + (r - 2) * math.cos(math.radians(ang)), cy + (r - 2) * math.sin(math.radians(ang))
        out.append(_dlg(2, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{cor}\\bord0{a1}{entra}\\p1}}{circulo(int(px), int(py), 10)}{{\\p0}}"))
    out.append(_dlg(3, a, z, 'Serif', f"{{\\an5\\pos({cx},{cy + 4})\\fs{int(r * 1.1)}\\c{cor}{a1}{entra}}}{n}"))
    return out


def _ficha(a, z, cx, cy, n, cor=AMARELO, r=74, acende=None):
    """Ficha apagada até a hora do item (`acende`) e acesa (com brilho) depois. acende=None: fica apagada no bloco."""
    out = []
    if acende is None or acende > a + 0.02:
        out += _ficha_desenho(a, z if acende is None else acende, cx, cy, n, cor, r, apagada=True)
    if acende is not None:
        out += _ficha_desenho(max(a, acende), z, cx, cy, n, cor, r, apagada=False)
    return out


def _linhas_de(texto, fs, largura, n, do_fim=False):
    """Até `n` linhas do texto; o que sobra vira '…' (do_fim: guarda o FIM do texto, que é o que encosta na frase atual)."""
    ls = quebrar(texto, fs, largura)
    if len(ls) <= n:
        return ls
    if do_fim:
        return ['…' + ls[-n]] + ls[-n + 1:]
    return ls[:n - 1] + [ls[n - 1] + '…']


def _numero(b, a, z, num, cx, cy, fs):
    """Número gigante. Inteiro com R$/%/mil… conta de 0 até o valor em 0,6 s (ano não conta); depois cresce devagar."""
    ev = []
    cor = b['acento']; dur = z - a
    passos = _contagem(num)
    glow = f"\\an5\\pos({cx},{cy})\\fs{fs}\\c{cor}\\blur26\\1a&H50&"
    if passos and dur > 1.2:
        dt = 0.05
        for k, v in enumerate(passos[:-1]):
            ev.append(_dlg(2, a + k * dt, a + (k + 1) * dt, 'Grosso', f"{{\\an5\\pos({cx},{cy})\\fs{fs}}}{esc(v)}"))
        t_fim = a + (len(passos) - 1) * dt
        ev.append(_dlg(2, t_fim, z, 'Grosso', f"{{\\an5\\pos({cx},{cy})\\fs{fs}\\t(0,{_ms(z - t_fim)},\\fscx106\\fscy106)}}{esc(num)}"))
        ev.append(_dlg(1, t_fim, z, 'Grosso', f"{{{glow}\\fad(150,0)\\t(0,{_ms(z - t_fim)},\\fscx106\\fscy106)}}{esc(num)}"))
    else:
        ev.append(_dlg(1, a, z, 'Grosso', f"{{{glow}\\t(300,{_ms(dur)},\\fscx106\\fscy106)}}{esc(num)}"))
        ev.append(_dlg(2, a, z, 'Grosso', f"{{\\an5\\pos({cx},{cy})\\fs{fs}\\fscx60\\fscy60\\t(0,260,\\fscx100\\fscy100)\\t(300,{_ms(dur)},\\fscx106\\fscy106)\\fad(120,0)}}{esc(num)}"))
    return ev


NUM_RX = re.compile(r'^(?P<pre>R\$\s?)?(?P<int>\d{1,3}(?:\.\d{3})+|\d+)(?P<suf>\s?(?:%|mil|milhões|milhão|bi|bilhões|bilhão|k|x|vezes))?$', re.I)


def _contagem(num):
    """'70%' → ['6%', '12%', …, '70%'] (12 passos com desaceleração). None quando não dá para contar (ano, decimal, texto)."""
    m = NUM_RX.match((num or '').strip())
    if not m:
        return None
    inteiro = int(m.group('int').replace('.', ''))
    if inteiro < 10 or (not m.group('pre') and not m.group('suf') and 1900 <= inteiro <= 2100):
        return None
    milhar = '.' in m.group('int')

    def fmt(v):
        s = f"{v:,}".replace(',', '.') if milhar else str(v)
        return f"{m.group('pre') or ''}{s}{m.group('suf') or ''}"
    passos = 12
    return [fmt(int(round(inteiro * (1 - (1 - k / passos) ** 3)))) for k in range(1, passos + 1)]


def _cartao_lado(a, z, x, y, w, h, texto, cor, ic):
    """Um lado da comparação: cartão com ícone (x ou check) em cima e o rótulo centralizado no espaço de baixo."""
    ev = _forma(a, z, caixa_arredondada(x, y, w, h, 28), cor, camada=2, contorno=4, extra='\\fad(120,0)')
    d = DESENHOS[ic]; tam = 0.6; cx, cy = x + w // 2, y + 125
    ev.append(_dlg(2, a, z, 'Forma', f"{{\\an5\\pos({cx},{cy})\\fscx{int(tam * 100)}\\fscy{int(tam * 100)}\\1a&HFF&\\3c{cor}\\bord7\\fad(120,0)\\p1}}{d}{{\\p0}}"))
    fs = 56 if len(texto) <= 14 else 48
    ev.append(_dlg(3, a, z, 'Sans', f"{{\\an5\\pos({cx},{y + 250 + (h - 250) // 2 - 30})\\fs{fs}{ENTRA}}}" + '\\N'.join(esc(l) for l in quebrar(texto, fs, w - 60)[:3])))
    return ev


def _traco(pontos):
    """Caminho de área zero (vai e volta pelos mesmos pontos): com \\bord vira um traço aberto, sem fechar a forma."""
    ida = ' '.join(f"l {x:.0f} {y:.0f}" for x, y in pontos[1:])
    volta = ' '.join(f"l {x:.0f} {y + 1:.0f}" for x, y in reversed(pontos[:-1]))
    return f"m {pontos[0][0]:.0f} {pontos[0][1]:.0f} {ida} {volta}"


def _grafico(b, a, z):
    """Gráfico de linha que se desenha (sobe ou desce), com eixos, grade leve e um ponto brilhando no fim."""
    x0, y0, x1, y1 = 170, 360, 910, 860
    cor = b['acento']; dur = z - a
    ev = [_dlg(1, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{CINZA_LINHA}\\bord0\\fad(200,0)\\p1}}m {x0} {y0} l {x0 + 6} {y0} l {x0 + 6} {y1} l {x1} {y1} l {x1} {y1 + 6} l {x0} {y1 + 6}{{\\p0}}")]
    for gy in (y0 + 125, y0 + 250, y0 + 375):
        ev.append(_dlg(1, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{CINZA_LINHA}\\1a&H90&\\bord0\\fad(200,0)\\p1}}m {x0 + 20} {gy} l {x1} {gy} l {x1} {gy + 2} l {x0 + 20} {gy + 2}{{\\p0}}"))
    pts = []
    for k in range(25):
        t = k / 24
        x = x0 + 30 + t * (x1 - x0 - 70)
        y = (y1 - 40) - (y1 - y0 - 90) * (t ** 2.2) if b.get('direcao') != 'desce' else (y0 + 50) + (y1 - y0 - 90) * (t ** 2.2)
        pts.append((x, y))
    caminho = _traco(pts)
    clip = f"\\clip({x0},{y0 - 60},{x0},{y1 + 60})\\t(200,1500,\\clip({x0},{y0 - 60},{x1 + 60},{y1 + 60}))"
    ev.append(_dlg(2, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\1a&HFF&\\3c{cor}\\bord16\\blur18\\3a&H60&{clip}\\p1}}{caminho}{{\\p0}}"))
    ev.append(_dlg(3, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\1a&HFF&\\3c{cor}\\bord5{clip}\\p1}}{caminho}{{\\p0}}"))
    xf, yf = pts[-1]
    if dur > 1.6:
        ev.append(_dlg(3, a + 1.4, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{cor}\\bord0\\blur10\\fad(200,0){_pulso(dur - 1.4, '&H00&', '&H60&', 0.6, 0.3).replace('3a', '1a')}\\p1}}{circulo(int(xf), int(yf), 22)}{{\\p0}}"))
        ev.append(_dlg(3, a + 1.4, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{BRANCO}\\bord0\\fad(200,0)\\p1}}{circulo(int(xf), int(yf), 10)}{{\\p0}}"))
        if b.get('rotulo'):   # longe da linha: subindo, acima do ponto final; descendo, à esquerda dele (abaixo da curva)
            ancora, px, py = ('\\an3', int(xf) - 40, int(yf) - 24) if b.get('direcao') != 'desce' else ('\\an6', int(xf) - 44, int(yf) - 8)
            ev.append(_dlg(3, a + 1.5, z, 'Sans', f"{{{ancora}\\pos({px},{py})\\fs44\\c{cor}{ENTRA}}}{esc(b['rotulo'])}"))
    return ev


def graficos_bloco(b):
    """Eventos ASS dos gráficos de um bloco SPLIT (área de cima, y 110–1070: abaixo vêm a legenda, a cabeça e a janela)."""
    a, z, tipo = b['t0'], b['t1'], b['tipo']
    ev = []
    cab = b.get('cabeca') or b.get('chave') or ''
    if tipo == 'titulo':
        if b.get('gancho'):   # abertura: o gancho entra grande, linha a linha; depois vêm o título e a imagem
            gf = b['gancho_fim']
            ev += _gancho(b, a, gf)
            a = gf
        partes = (b.get('titulo') or '').strip().rstrip('.').split()
        corte = max(1, len(partes) - 3) if len(partes) > 4 else max(1, len(partes) // 2)
        l1, l2 = ' '.join(partes[:corte]), ' '.join(partes[corte:])
        ev.append(_dlg(3, a, z, 'Sans', f"{{\\an5\\pos({W // 2},{175})\\fs68{ENTRA}}}{esc(l1)}"))
        fs2 = 112 if len(l2) <= 18 else 92 if len(l2) <= 26 else 74
        ev.append(_dlg(3, a, z, 'Serif', f"{{\\an5\\pos({W // 2},{268})\\fs{fs2}\\blur16\\alpha&HFF&\\t(200,520,\\blur0\\alpha&H00&)}}{esc(l2)}"))
        lw = min(W - 140, int(len(l2) * fs2 * 0.42)); x0 = W // 2 - lw // 2
        ev.append(_dlg(2, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{b['acento']}\\bord0\\clip({x0},314,{x0},334)\\t(450,900,\\clip({x0},314,{x0 + lw},334))\\p1}}m {x0} 320 l {x0 + lw} 320 l {x0 + lw} 326 l {x0} 326{{\\p0}}"))
        if b.get('sem_inset'):
            ev += _icone(b, a, z, W // 2, 720, tam=2.0)
        else:
            q = INSET_TITULO
            ev += _forma(a, z, caixa_arredondada(q['x'], q['y'], q['w'], q['h'], q['raio']), b['acento'], camada=2, contorno=3)
    elif tipo == 'lista':
        lista = b['lista']; n = lista['n']
        ev += _titulo_secao(b, a, z, lista['titulo'])
        ys = {2: [500, 790], 3: [430, 660, 890], 4: [390, 590, 790, 990]}[n]
        ja = b.get('ja') or []; novos = b.get('itens_novos') or []
        tempos = b.get('tempos_itens') or []
        pal = b.get('palavras') or []
        for k in range(n):
            if k < len(ja):
                acende = a
            elif k - len(ja) < min(len(novos), len(tempos)):
                acende = tempos[k - len(ja)]
            else:
                acende = None
            ev += _ficha(a, z, 210, ys[k], k + 1, acende=acende)
            if k < len(ja):   # itens que já foram ditos ficam acesos
                ev.append(_dlg(3, a, z, 'Sans', f"{{\\an4\\pos(325,{ys[k]})\\fs54}}" + '\\N'.join(esc(x) for x in quebrar(_curto(_rotulo_item(lista, k, ja[k]), 7), 54, 650))))
        # itens novos acendem palavra a palavra no tempo da fala (os do plano entram inteiros na hora em que são ditos)
        for j, item in enumerate(novos):
            k = len(ja) + j
            if k >= n:
                break
            t_item = tempos[j] if j < len(tempos) else a
            curto = (lista.get('rotulos') or [])[k] if k < len(lista.get('rotulos') or []) else None
            ws = [] if (b.get('itens_do_plano') or curto or b.get('ordinal')) else _palavras_do_item(item, pal)
            if curto:
                item = curto
            if ws:
                ev += _karaoke(b, max(a, ws[0]['n0'] - 0.05), z, 325, ys[k], 54, 650, palavras=_curto_pal(ws, 7), alinhamento=4)
            else:
                ev.append(_dlg(3, t_item, z, 'Sans', f"{{\\an4\\pos(325,{ys[k]})\\fs54{ENTRA}}}" + '\\N'.join(esc(x) for x in quebrar(_curto(item, 7), 54, 650))))
    elif tipo == 'frase':
        x0, y0, w, h = 120, 290, 840, 780
        ev += _forma(a, z, caixa_arredondada(x0, y0, w, h, 22), BRANCO, camada=2, contorno=3, extra='\\fad(200,0)')
        rotulo = b.get('rotulo_cartao') or ('REGRA' if re.search(r'\bquem\b|regra|manda|sempre|nunca', b['texto'], re.I) else 'LIÇÃO')
        ev.append(_dlg(3, a, z, 'Sans', f"{{\\an5\\pos({W // 2},{y0 + 70})\\fs40\\fsp4{ENTRA}}}{rotulo}"))
        # as linhas são o roteiro de verdade: a frase de antes e a de depois apagadas, a atual acende no tempo da fala
        antes = _linhas_de(b.get('antes') or '', 34, w - 170, 2, do_fim=True)
        depois = _linhas_de(b.get('depois') or '', 34, w - 170, 2)
        if antes:
            ev.append(_dlg(3, a, z, 'Sans', f"{{\\an5\\pos({W // 2},{y0 + 190})\\fs34\\b0\\c{CINZA_ROTEIRO}\\fad(250,0)}}" + '\\N'.join(esc(l) for l in antes)))
        ev += _karaoke(b, a, z, W // 2, y0 + 400, _fs_texto(b['texto'], 58), w - 150)
        if depois:
            ev.append(_dlg(3, a, z, 'Sans', f"{{\\an5\\pos({W // 2},{y0 + 615})\\fs34\\b0\\c{CINZA_ROTEIRO}\\fad(250,0)}}" + '\\N'.join(esc(l) for l in depois)))
    elif tipo == 'numero':
        num = b.get('destaque') or (palavra_chave(b['texto']) if re.search(r'\d', b['texto']) else (b.get('chave') or ''))
        fsn = 330 if len(num) <= 4 else 250 if len(num) <= 7 else 180
        if b.get('cabeca'):
            ev += _titulo_secao(b, a, z, b['cabeca'])
        ev += _numero(b, a, z, num, W // 2, 540, fsn)
        ev += _karaoke(b, a, z, W // 2, 900, _fs_texto(b['texto'], 56), 900)
    elif tipo == 'icone':
        ev += _titulo_secao(b, a, z, cab)
        ev += _icone(b, a, z, W // 2, 560, tam=2.1)
        ev += _karaoke(b, a, z, W // 2, 960, _fs_texto(b['texto'], 56), 900)
    elif tipo == 'comparacao':
        ev += _titulo_secao(b, a, z, b.get('cabeca') or 'A diferença')
        t_esq, t_dir = (b.get('tempos_itens') or [a + 0.1, a + (z - a) * 0.5])[:2]
        ev += _cartao_lado(t_esq, z, 70, 330, 440, 460, b['esquerda'], VERMELHO, 'x')
        ev += _cartao_lado(t_dir, z, 570, 330, 440, 460, b['direita'], VERDE, 'check')
        ev.append(_dlg(3, t_esq, z, 'Sans', f"{{\\an5\\pos({W // 2},{560})\\fs44\\c{CINZA}{ENTRA}}}vs"))
        ev += _karaoke(b, a, z, W // 2, 910, _fs_texto(b['texto'], 52), 900)
    elif tipo == 'grafico':
        ev += _titulo_secao(b, a, z, b.get('cabeca') or ('Crescimento' if b.get('direcao') != 'desce' else 'Queda'))
        ev += _grafico(b, a, z)
        ev += _karaoke(b, a, z, W // 2, 975, _fs_texto(b['texto'], 48), 900)
    elif tipo == 'foto':
        ev += _foto(b, a, z)
    elif tipo == 'celular':
        ev += _celular(b, a, z)
    elif tipo == 'imagem':
        ev += _titulo_secao(b, a, z, cab)
        q = INSET_IMAGEM
        ev += _forma(a, z, caixa_arredondada(q['x'], q['y'], q['w'], q['h'], q['raio']), b['acento'], camada=2, contorno=3)
        # etiqueta: só com informação nova (nome, ano, número) — nunca a mesma palavra do título ou da legenda
        tag = esc(b.get('rotulo') or '')
        if tag:
            fs = 44; tw = int(len(tag) * fs * 0.6) + 48; tx, ty = q['x'] + 36, q['y'] + q['h'] - 100
            ev += _forma(a + 0.3, z, caixa_arredondada(tx, ty, tw, 68, 14), VERDE, camada=4, glow=False, extra='\\fad(150,0)')
            ev.append(_dlg(5, a + 0.3, z, 'Sans', f"{{\\an4\\pos({tx + 24},{ty + 34})\\fs{fs}\\c{PRETO}\\fad(150,0)}}{tag}"))
    return ev


def _rotulo_item(lista, k, padrao):
    r = lista.get('rotulos') or []
    return r[k] if k < len(r) and r[k] else padrao


def _gancho(b, a, z):
    """Gancho da abertura: linhas grandes (Inter Tight), uma a cada PASSO_GANCHO s com 'pop' de escala; a palavra
    principal (a mais longa ou com número) na cor de destaque. Some rápido antes do título entrar."""
    linhas = _linhas_gancho(b['gancho'])
    if not linhas:
        return []
    fs = max(96, min(190, int(940 / (0.64 * max(len(l) for l in linhas)))))   # a linha mais longa ocupa ~940 px
    passo = int(fs * 1.02)
    y0 = 590 - (len(linhas) - 1) * passo // 2
    chave = max(range(len(linhas)), key=lambda k: (bool(re.search(r'\d', linhas[k])), len(linhas[k])))
    ev = []
    for k, ln in enumerate(linhas):
        ini = a + 0.05 + k * PASSO_GANCHO
        if ini >= z - 0.1:
            break
        cor = f"\\c{b['acento']}" if k == chave else ''
        ev.append(_dlg(4, ini, z, 'Grosso', f"{{\\an5\\pos({W // 2},{y0 + k * passo})\\fs{fs}{cor}\\fscx135\\fscy135\\alpha&HFF&\\t(0,90,\\alpha&H00&)\\t(0,170,\\fscx100\\fscy100)\\fad(0,160)}}{esc(ln.upper())}"))
    return ev


def _foto(b, a, z):
    """Foto de uso livre de pessoa/marca famosa (Wikimedia) na moldura, com o nome numa etiqueta e o crédito da foto."""
    q = INSET_IMAGEM
    ev = _titulo_secao(b, a, z, b.get('cabeca') or b.get('pessoa') or '')
    ev += _forma(a, z, caixa_arredondada(q['x'], q['y'], q['w'], q['h'], q['raio']), b['acento'], camada=2, contorno=3)
    nome = esc(b.get('rotulo') or b.get('pessoa') or '')
    if nome and _norm(nome) != _norm(b.get('cabeca')):
        fs = 44; tw = int(len(nome) * fs * 0.6) + 48; tx, ty = q['x'] + 36, q['y'] + q['h'] - 100
        ev += _forma(a + 0.3, z, caixa_arredondada(tx, ty, tw, 68, 14), VERDE, camada=4, glow=False, extra='\\fad(150,0)')
        ev.append(_dlg(5, a + 0.3, z, 'Sans', f"{{\\an4\\pos({tx + 24},{ty + 34})\\fs{fs}\\c{PRETO}\\fad(150,0)}}{nome}"))
    cred = esc(b.get('credito') or '')
    if cred:   # crédito exigido pela licença da foto (CC BY / CC BY-SA)
        ev.append(_dlg(5, a, z, 'Sans', f"{{\\an3\\pos({q['x'] + q['w'] - 24},{q['y'] + q['h'] - 16})\\fs20\\b0\\c&HFFFFFF&\\3c&H000000&\\bord2\\shad0}}{cred}"))
    return ev


def _celular(b, a, z):
    """Celular desenhado com uma busca sendo digitada (lupa, texto letra a letra, cursor) e a frase na tela."""
    x0, y0, w, h = 270, 290, 540, 740
    cor = b['acento']
    ev = _titulo_secao(b, a, z, b.get('cabeca') or '')
    ev += _forma(a, z, caixa_arredondada(x0, y0, w, h, 64), BRANCO, camada=2, contorno=5, extra='\\fad(150,0)')
    ev.append(_dlg(2, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{BRANCO}\\bord0\\fad(150,0)\\p1}}{caixa_arredondada(x0 + w // 2 - 70, y0 + 22, 140, 26, 13)}{{\\p0}}"))
    bx, by, bw, bh = x0 + 36, y0 + 90, w - 72, 86
    ev += _forma(a + 0.15, z, caixa_arredondada(bx, by, bw, bh, 43), cor, camada=2, contorno=3, extra='\\fad(150,0)')
    ev.append(_dlg(3, a + 0.15, z, 'Forma', f"{{\\pos(0,0)\\an7\\1a&HFF&\\3c{BRANCO}\\bord4\\fad(150,0)\\p1}}{circulo(bx + 44, by + 38, 15)}{{\\p0}}"))
    ev.append(_dlg(3, a + 0.15, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{BRANCO}\\bord0\\fad(150,0)\\p1}}m {bx + 54} {by + 50} l {bx + 70} {by + 66} l {bx + 64} {by + 72} l {bx + 48} {by + 56}{{\\p0}}"))
    texto = b.get('busca_tela') or ''
    fs = 38 if len(texto) <= 22 else 32
    passos = max(1, min(len(texto), 14)); t_dig = a + 0.35; dur_dig = min(1.4, max(0.6, (z - a) * 0.35))
    for k in range(1, passos + 1):   # digitando: o texto cresce em até 14 passos
        n = int(round(len(texto) * k / passos)); ini = t_dig + dur_dig * (k - 1) / passos
        fim = t_dig + dur_dig * k / passos if k < passos else z
        ev.append(_dlg(4, ini, fim, 'Sans', f"{{\\an4\\pos({bx + 84},{by + bh // 2})\\fs{fs}\\b0}}{esc(texto[:n])}{'|' if k < passos else ''}"))
    ev += _karaoke(b, a, z, W // 2, y0 + 430, _fs_texto(b['texto'], 52), w - 90)
    return ev


def _curto(t, maximo=5):
    w = (t or '').split()
    return ' '.join(w[:maximo]) + ('…' if len(w) > maximo else '')


def _palavras_do_item(item, pal):
    alvo = [limpa(w).lower() for w in item.split()][:3]
    for i in range(len(pal)):
        if [limpa(p['w']).lower() for p in pal[i:i + len(alvo)]] == alvo:
            return pal[i:i + len(item.split())]
    return []


def _curto_pal(ws, maximo=5):
    return ws[:maximo]


def ass_graficos(blocos):
    """Gráficos da área de cima, só nos blocos SPLIT (os outros layouts cobrem a tela inteira por cima)."""
    linhas = []
    for b in blocos:
        if b['layout'] == 'split':
            linhas += graficos_bloco(b)
    return cabecalho() + '\n'.join(linhas) + '\n'


def _logo_instagram(a, z, cx, cy, tam, cor=BRANCO, camada=6, glow=False):
    s = tam; x0, y0 = cx - s // 2, cy - s // 2
    out = []
    out += _forma(a, z, caixa_arredondada(x0, y0, s, s, int(s * 0.28)), cor, camada=camada, contorno=max(3, s // 16), glow=glow)
    out += _forma(a, z, circulo(cx, cy, int(s * 0.23)), cor, camada=camada, contorno=max(3, s // 16), glow=False)
    out.append(_dlg(camada, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{cor}\\bord0\\p1}}{circulo(int(cx + s * 0.27), int(cy - s * 0.27), max(3, s // 14))}{{\\p0}}"))
    return out


def _tela_final(a, z, texto=''):
    """Tela final LIMPA: em cima, fundo opaco (nada do bloco anterior aparece por baixo); a janela do Pedro escurece;
    chamada (se ele falou uma), logo do Instagram e o @."""
    corte = JANELA['y'] - RECORTE - 40
    out = [_dlg(5, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c&H000000&\\alpha&HFF&\\t(0,300,\\alpha&H00&)\\bord0\\p1}}m 0 0 l {W} 0 l {W} {corte} l 0 {corte}{{\\p0}}"),
           _dlg(5, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c&H000000&\\alpha&HFF&\\t(0,300,\\alpha&H40&)\\bord0\\p1}}m 0 {corte} l {W} {corte} l {W} {H} l 0 {H}{{\\p0}}")]
    partes = (texto or '').strip().rstrip('.!').split()
    if partes:
        corte_l = min(len(partes), 3)
        l1, l2 = ' '.join(partes[:corte_l]), ' '.join(partes[corte_l:corte_l + 6])
        out.append(_dlg(7, a, z, 'Sans', f"{{\\an5\\pos({W // 2},{330})\\fs70{ENTRA}}}{esc(l1)}"))
        if l2:
            out.append(_dlg(7, a, z, 'Serif', f"{{\\an5\\pos({W // 2},{420})\\fs84\\blur16\\alpha&HFF&\\t(200,500,\\blur0\\alpha&H00&)}}{esc(l2)}"))
    out += _logo_instagram(a + 0.2, z, W // 2, 760 if partes else 640, 220, cor=ROSA, camada=8, glow=True)
    out.append(_dlg(8, a + 0.3, z, 'Sans', f"{{\\an5\\pos({W // 2},{950 if partes else 830})\\fs50\\fsp2{ENTRA}}}{HANDLE}"))
    return out


def ass_final(blocos, palavras, duracao):
    """Camada de cima: legenda de UMA palavra por vez e a tela final (chamada + logo do Instagram + @)."""
    linhas = []   # sem marca d'água lateral (pedido do Pedro): o @ fica só na tela final
    fim = next((b for b in blocos if b['layout'] == 'fim'), None)
    if fim:
        linhas += _tela_final(fim['t0'], fim['t1'], '' if fim.get('sem_chamada') else fim['texto'])
    elif blocos and duracao > 8:   # blocos de fora do planejar: tela final nos últimos 1,6 s
        linhas += _tela_final(max(blocos[-1]['t0'], duracao - 1.6), duracao)
    # legenda: uma palavra por vez
    for i, p in enumerate(palavras):
        ini = p['n0']; fim_p = palavras[i + 1]['n0'] if i + 1 < len(palavras) else min(duracao, p['n1'] + 0.4)
        if fim_p - ini < 0.04:
            continue
        bl = bloco_em(blocos, ini + 0.01)
        lay = bl['layout'] if bl else 'split'
        y = Y_LEGENDA.get(lay, Y_LEGENDA['split'])
        cor = f"\\c{AMARELO}" if destaque_legenda(p['w'], bl) else ''
        linhas.append(_dlg(9, ini, fim_p, 'Legenda', f"{{\\an5\\pos({W // 2},{y}){cor}\\fscx92\\fscy92\\t(0,90,\\fscx100\\fscy100)}}{esc(p['w'].strip())}"))
    return cabecalho() + '\n'.join(linhas) + '\n'


def destaque_legenda(w, bloco):
    """Palavra da legenda que fica colorida: número/valor/porcentagem, ou palavra do título da cena (a ideia da cena)."""
    lw = limpa(w).lower()
    if not lw:
        return False
    if re.search(r'\d', lw) or '$' in (w or '') or '%' in (w or ''):
        return True
    if bloco and bloco.get('cabeca'):
        ideia = {limpa(x).lower() for x in bloco['cabeca'].split() if len(limpa(x)) >= 4 and limpa(x).lower() not in STOP}
        return lw in ideia
    return False


def trocas(blocos):
    return [b['t0'] for i, b in enumerate(blocos) if i and (b['layout'] != blocos[i - 1]['layout'] or b['tipo'] != blocos[i - 1]['tipo'])]
