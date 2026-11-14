"""Formato "Destrava" (referência: reels no estilo Kallaway que o Pedro mandou em 14/11/2026). Sem IA.

Tela 1080x1920:
  - SPLIT (a maior parte do tempo): fundo quase preto com grade de pontos; em cima, gráficos animados com brilho
    (título com fonte mista, fichas numeradas, cartão de "regra", número gigante, ícone neon, vídeo em moldura brilhante);
    embaixo, o Pedro numa janela de cantos arredondados (x 66, y 1400, 948x520). Legenda: UMA palavra por vez na emenda.
  - ROSTO: close do Pedro em tela cheia (a cada ~10 s, frases curtas) — legenda e @ mudam de lugar.
  - BROLL: cena de banco de imagens em tela cheia (no máximo 1 a cada ~16 s).
  - FIM: na frase de chamada final ("salva…", "comenta…"), tudo escurece, entra a chamada + logo do Instagram + @.
Os textos dos gráficos "acendem" palavra a palavra no tempo da fala (cinza → branco), como na referência.
"""
import re

W, H = 1080, 1920
JANELA = {'x': 66, 'y': 1400, 'w': 948, 'h': 520, 'raio': 40}
INSET_IMAGEM = {'x': 140, 'y': 370, 'w': 800, 'h': 780, 'raio': 36}
INSET_TITULO = {'x': 170, 'y': 440, 'w': 740, 'h': 640, 'raio': 36}
Y_LEGENDA = {'split': 1290, 'rosto': 1160, 'broll': 1160, 'fim': 1290}
HANDLE = '@PEDRO_DESTRAVA'

# cores ASS (&HAABBGGRR)
BRANCO = '&H00FFFFFF&'; CINZA = '&H00606066&'; CINZA_LINHA = '&H00403A3A&'
AMARELO = '&H0047E0FD&'; LARANJA = '&H004370FF&'; AZUL = '&H00FF6A3D&'; VERDE = '&H005EC522&'; ROXO = '&H00F755A8&'; ROSA = '&H00A23DE1&'
ACENTOS = [LARANJA, AZUL, AMARELO, VERDE, ROXO]

STOP = set('''a o e é de da do das dos em no na nos nas um uma uns umas que se não sim eu tu ele ela nós eles elas meu minha
seu sua seus suas nosso nossa isso isto aquilo esse essa este esta aquele aquela para pra por pelo pela com sem mais menos
muito muita muitos muitas pouco já também só ainda quando onde como porque qual quais quem lhe me te ao aos à às ou mas
então tá né vai vou foi ser ter tem era está estão estava você vocês dela dele deles delas há até sobre entre depois antes
cada todo toda todos todas outro outra mesmo mesma coisa coisas fazer faz fez qualquer'''.split())
NEGOCIO = r'dinheir|marca|client|preç|lucr|investi|empres|negóci|negoci|venda|produto|imposto|caixa|loja|custo|margem|salári|dívida|crédito|juros|sucesso|qualidade|estratég|foco|resultado|milh|bilh|cresc|gigant|riqueza|liberdade|governo|taxa|multa|lição|segredo|estoque|sócio|socio|fundo|anúnci|anunci|venda'
VERBO = r'(ar|er|ir|ou|eu|iu|ava|ando|endo|indo|ado|ido|aram|eram|iram|amos|emos|imos)$'
CTA = re.compile(r'\b(salva|salve|comenta|comente|manda|mande|compartilha|compartilhe|segue|siga|link na bio|marca alguém|marque)\b', re.I)
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
]
# ícones neon (contorno), caixa 240x240
DESENHOS = {
    'seta': 'm 120 0 l 240 130 l 165 130 l 165 240 l 75 240 l 75 130 l 0 130',
    'x': 'm 30 0 l 120 90 l 210 0 l 240 30 l 150 120 l 240 210 l 210 240 l 120 150 l 30 240 l 0 210 l 90 120 l 0 30',
    'check': 'm 0 130 l 40 90 l 95 145 l 200 20 l 240 60 l 95 225',
    'alvo': 'm 120 0 b 186 0 240 54 240 120 b 240 186 186 240 120 240 b 54 240 0 186 0 120 b 0 54 54 0 120 0 m 120 60 b 87 60 60 87 60 120 b 60 153 87 180 120 180 b 153 180 180 153 180 120 b 180 87 153 60 120 60',
    'lampada': 'm 120 0 b 190 0 240 50 240 115 b 240 160 215 185 190 205 l 190 240 l 50 240 l 50 205 b 25 185 0 160 0 115 b 0 50 50 0 120 0',
    'relogio': 'm 120 0 b 186 0 240 54 240 120 b 240 186 186 240 120 240 b 54 240 0 186 0 120 b 0 54 54 0 120 0 m 112 40 l 128 40 l 128 115 l 180 148 l 172 162 l 112 124',
    'estrela': 'm 120 0 l 150 85 l 240 88 l 168 142 l 195 230 l 120 178 l 45 230 l 72 142 l 0 88 l 90 85',
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
def _partir(f, maximo=5.0):
    pal = f.get('palavras') or []
    if f['n1'] - f['n0'] <= maximo or len(pal) < 6:
        return [f]
    # parte na pontuação mais perto do meio; sem pontuação, na palavra do meio
    alvo = (f['n0'] + f['n1']) / 2
    cand = [i for i in range(2, len(pal) - 2) if re.search(r'[,.;:!?]$', pal[i - 1]['w'])] or list(range(2, len(pal) - 2))
    k = min(cand, key=lambda i: abs(pal[i]['n0'] - alvo))
    a = {'n0': f['n0'], 'n1': pal[k]['n0'], 'palavras': pal[:k]}
    b = {'n0': pal[k]['n0'], 'n1': f['n1'], 'palavras': pal[k:]}
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


def planejar(frases, duracao, titulo='', broll=True):
    """frases [{n0,n1,texto,palavras:[{n0,n1,w}]}] (tempo final) → blocos contíguos com layout e gráfico."""
    duracao = float(duracao)
    partes = []
    for f in sorted(frases, key=lambda f: f['n0']):
        partes += _partir(f)
    juntas = []
    for x in partes:
        if juntas and (x['n1'] - x['n0'] < 1.0):
            j = juntas[-1]
            juntas[-1] = {'n0': j['n0'], 'n1': x['n1'], 'texto': f"{j['texto']} {x['texto']}", 'palavras': j['palavras'] + x['palavras']}
        else:
            juntas.append(dict(x))
    if not juntas:
        return [{'t0': 0.0, 't1': duracao, 'layout': 'split', 'tipo': 'titulo', 'titulo': titulo or '', 'texto': '', 'palavras': [], 'acento': LARANJA}]
    blocos = []
    ultimo_rosto, ultimo_broll, alterna, lista_pendente = 0.0, -99.0, 0, None
    for i, x in enumerate(juntas):
        t0 = 0.0 if i == 0 else round(x['n0'], 3)
        t1 = duracao if i == len(juntas) - 1 else round(juntas[i + 1]['n0'], 3)
        texto = x['texto']; dur = t1 - t0
        b = {'t0': t0, 't1': t1, 'texto': texto, 'palavras': x['palavras'], 'chave': palavra_chave(texto), 'icone': icone(texto),
             'acento': ACENTOS[i % len(ACENTOS)], 'layout': 'split'}
        m = CONTAGEM.search(texto)
        if i == 0:
            b.update(tipo='titulo', titulo=titulo or texto)
        elif i == len(juntas) - 1 and CTA.search(texto):
            b.update(layout='fim', tipo='fim')
        elif lista_pendente and len(lista_pendente['itens']) < lista_pendente['n']:
            itens = itens_da_lista(texto, lista_pendente['n'] - len(lista_pendente['itens'])) or [_sem_conjuncao(texto)]
            b.update(tipo='lista', lista=lista_pendente, itens_novos=list(itens), ja=list(lista_pendente['itens']))
            lista_pendente['itens'] = lista_pendente['itens'] + list(itens)
        elif m:
            g = m.group(1).lower()
            n = max(2, min(4, int(g) if g.isdigit() else NUM_EXT.get(g, 2)))
            lista = {'n': n, 'titulo': f"{m.group(1).capitalize()} {m.group(2).lower()}", 'itens': []}
            itens = itens_da_lista(texto, n) if ':' in texto else []
            lista['itens'] = list(itens)            # cópias: a lista cresce nos blocos seguintes sem mexer neste
            b.update(tipo='lista', lista=lista, itens_novos=list(itens), ja=[])
            lista_pendente = lista if len(itens) < n else None
        elif t0 - ultimo_rosto >= 8.0 and 1.3 <= dur <= 4.2 and i > 1:
            b.update(layout='rosto', tipo='rosto'); ultimo_rosto = t1
        elif broll and t0 - ultimo_broll >= 16.0 and 1.5 <= dur <= 3.6 and i > 2 and blocos and blocos[-1]['layout'] == 'split':
            b.update(layout='broll', tipo='broll'); ultimo_broll = t1
        elif re.search(r'\d', texto):
            b.update(tipo='numero')
        elif REGRA.search(texto) and len(texto.split()) <= 14:
            b.update(tipo='frase')
        else:
            b.update(tipo=('imagem' if (broll and alterna % 2 == 0) else 'icone')); alterna += 1
        if b['tipo'] != 'lista':
            lista_pendente = None if b['tipo'] not in ('rosto',) else lista_pendente
        blocos.append(b)
    return blocos


def precisa_broll(blocos):
    """Blocos que pedem vídeo de banco: inset (título/imagem) ou tela cheia (broll)."""
    return [b for b in blocos if b['tipo'] in ('titulo', 'imagem', 'broll')]


def sem_broll(b):
    """Quando o banco de imagens não devolveu nada para o bloco."""
    if b['tipo'] == 'imagem':
        b['tipo'] = 'icone'
    elif b['tipo'] == 'broll':
        b['layout'] = 'rosto'; b['tipo'] = 'rosto'
    elif b['tipo'] == 'titulo':
        b['sem_inset'] = True


def layout_em(blocos, t):
    for b in blocos:
        if b['t0'] <= t < b['t1']:
            return b['layout']
    return blocos[-1]['layout'] if blocos else 'split'


# ── ASS ───────────────────────────────────────────────────────────────────────────────────────────────────────────
def cabecalho():
    return ("[Script Info]\nScriptType: v4.00+\n"
            f"PlayResX: {W}\nPlayResY: {H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\n\n"
            "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
            "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            "Style: Sans,Inter,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n"
            "Style: Serif,Instrument Serif,100,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,-1,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n"
            "Style: Grosso,Inter Tight,300,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n"
            "Style: Forma,Inter,20,&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n"
            "Style: Legenda,Inter,70,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,-1,0,0,0,100,100,0,0,1,0,3,5,0,0,0,1\n\n"
            "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")


def _dlg(camada, a, z, estilo, texto):
    return f"Dialogue: {camada},{t_ass(a)},{t_ass(z)},{estilo},,0,0,0,,{texto}"


ENTRA = '\\blur16\\alpha&HFF&\\t(0,320,\\blur0\\alpha&H00&)'   # entrada com desfoque (como na referência)


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


def _titulo_secao(b, a, z, texto, y=170, fs=72):
    return [_dlg(3, a, z, 'Sans', f"{{\\an5\\pos({W // 2},{y})\\fs{fs}{ENTRA}}}{esc(texto)}")]


def _icone(b, a, z, cx, cy, tam=1.5):
    ic = b.get('icone') or 'estrela'; cor = b['acento']
    if ic in ('dinheiro', 'pergunta'):
        txt = 'R$' if ic == 'dinheiro' else '?'
        fs = int(220 * tam / 1.5)
        return [_dlg(1, a, z, 'Sans', f"{{\\an5\\pos({cx},{cy})\\fs{fs}\\1a&HFF&\\3c{cor}\\bord14\\blur20\\3a&H60&}}{txt}"),
                _dlg(2, a, z, 'Sans', f"{{\\an5\\pos({cx},{cy})\\fs{fs}\\1a&HFF&\\3c{cor}\\bord5{ENTRA}}}{txt}")]
    s = int(240 * tam); x0, y0 = cx - s // 2, cy - s // 2
    escala = f"\\fscx{int(tam * 100)}\\fscy{int(tam * 100)}"
    d = DESENHOS.get(ic, DESENHOS['estrela'])
    clip = f"\\clip({x0 - 20},{y0 - 20},{x0 - 20},{y0 + s + 20})\\t(0,500,\\clip({x0 - 20},{y0 - 20},{x0 + s + 20},{y0 + s + 20}))"
    return [_dlg(1, a, z, 'Forma', f"{{\\an7\\pos({x0},{y0}){escala}\\1a&HFF&\\3c{cor}\\bord14\\blur20\\3a&H60&{clip}\\p1}}{d}{{\\p0}}"),
            _dlg(2, a, z, 'Forma', f"{{\\an7\\pos({x0},{y0}){escala}\\1a&HFF&\\3c{cor}\\bord6{clip}\\p1}}{d}{{\\p0}}")]


def _ficha(a, z, cx, cy, n, cor=AMARELO, r=62):
    """Ficha de cassino numerada (como as fichas douradas da referência)."""
    out = _forma(a, z, circulo(cx, cy, r), cor, camada=2, contorno=7)
    out += _forma(a, z, circulo(cx, cy, r - 20), cor, camada=2, glow=False, contorno=3)
    for ang in range(0, 360, 45):   # entalhes da borda
        import math
        px, py = cx + (r - 2) * math.cos(math.radians(ang)), cy + (r - 2) * math.sin(math.radians(ang))
        out.append(_dlg(2, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{cor}\\bord0\\p1}}{circulo(int(px), int(py), 9)}{{\\p0}}"))
    out.append(_dlg(3, a, z, 'Serif', f"{{\\an5\\pos({cx},{cy + 4})\\fs{int(r * 1.1)}\\c{cor}}}{n}"))
    return out


def graficos_bloco(b):
    """Eventos ASS dos gráficos de um bloco SPLIT (área de cima, y 110–1240)."""
    a, z, tipo = b['t0'], b['t1'], b['tipo']
    ev = []
    if tipo == 'titulo':
        partes = (b.get('titulo') or '').strip().rstrip('.').split()
        corte = max(1, len(partes) - 3) if len(partes) > 4 else max(1, len(partes) // 2)
        l1, l2 = ' '.join(partes[:corte]), ' '.join(partes[corte:])
        ev.append(_dlg(3, a, z, 'Sans', f"{{\\an5\\pos({W // 2},{175})\\fs64{ENTRA}}}{esc(l1)}"))
        fs2 = 104 if len(l2) <= 18 else 86 if len(l2) <= 26 else 70
        ev.append(_dlg(3, a, z, 'Serif', f"{{\\an5\\pos({W // 2},{262})\\fs{fs2}\\blur16\\alpha&HFF&\\t(200,520,\\blur0\\alpha&H00&)}}{esc(l2)}"))
        lw = min(W - 140, int(len(l2) * fs2 * 0.42)); x0 = W // 2 - lw // 2
        ev.append(_dlg(2, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{b['acento']}\\bord0\\clip({x0},300,{x0},320)\\t(450,900,\\clip({x0},300,{x0 + lw},320))\\p1}}m {x0} 306 l {x0 + lw} 306 l {x0 + lw} 312 l {x0} 312{{\\p0}}"))
        if b.get('sem_inset'):
            ev += _icone(b, a, z, W // 2, 760, tam=1.7)
        else:
            q = INSET_TITULO
            ev += _forma(a, z, caixa_arredondada(q['x'], q['y'], q['w'], q['h'], q['raio']), b['acento'], camada=2, contorno=3)
    elif tipo == 'lista':
        lista = b['lista']; n = lista['n']
        ev += _titulo_secao(b, a, z, lista['titulo'])
        ys = {2: [600, 900], 3: [520, 760, 1000], 4: [470, 680, 890, 1100]}[n]
        ja = b.get('ja') or []
        for k in range(n):
            ev += _ficha(a, z, 200, ys[k], k + 1)
            if k < len(ja):   # itens que já foram ditos ficam acesos
                ev.append(_dlg(3, a, z, 'Sans', f"{{\\an4\\pos(300,{ys[k]})\\fs50}}" + '\\N'.join(esc(x) for x in quebrar(_curto(ja[k], 7), 50, 620))))
        # itens novos acendem palavra a palavra no tempo da fala
        novos = b.get('itens_novos') or []
        pal = b.get('palavras') or []
        for j, item in enumerate(novos):
            k = len(ja) + j
            if k >= n:
                break
            ws = _palavras_do_item(item, pal)
            if ws:
                ev += _karaoke(b, max(a, ws[0]['n0'] - 0.05), z, 300, ys[k], 50, 620, palavras=_curto_pal(ws, 7), alinhamento=4)
            else:
                ev.append(_dlg(3, a, z, 'Sans', f"{{\\an4\\pos(300,{ys[k]})\\fs50{ENTRA}}}" + '\\N'.join(esc(x) for x in quebrar(_curto(item, 7), 50, 620))))
    elif tipo == 'frase':
        x0, y0, w, h = 150, 330, 780, 860
        ev += _forma(a, z, caixa_arredondada(x0, y0, w, h, 18), BRANCO, camada=2, contorno=3, extra='\\fad(200,0)')
        rotulo = 'REGRA' if re.search(r'\bquem\b|regra|manda|sempre|nunca', b['texto'], re.I) else 'LIÇÃO'
        ev.append(_dlg(3, a, z, 'Sans', f"{{\\an5\\pos({W // 2},{y0 + 80})\\fs44\\fsp3{ENTRA}}}{rotulo}"))
        for yy, ww in [(y0 + 160, 600), (y0 + 210, 420), (y0 + 260, 560), (y0 + 650, 640), (y0 + 700, 380), (y0 + 750, 560)]:
            ev.append(_dlg(2, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c{CINZA_LINHA}\\bord0\\fad(250,0)\\p1}}{caixa_arredondada(x0 + 90, yy, ww, 14, 7)}{{\\p0}}"))
        ev += _karaoke(b, a, z, W // 2, y0 + 455, 54, w - 140)
    elif tipo == 'numero':
        num = palavra_chave(b['texto']) if re.search(r'\d', b['texto']) else (b.get('chave') or '')
        fsn = 260 if len(num) <= 4 else 190 if len(num) <= 7 else 140
        ev.append(_dlg(1, a, z, 'Grosso', f"{{\\an5\\pos({W // 2},{560})\\fs{fsn}\\c{b['acento']}\\blur26\\1a&H50&}}{esc(num)}"))
        ev.append(_dlg(2, a, z, 'Grosso', f"{{\\an5\\pos({W // 2},{560})\\fs{fsn}\\fscx60\\fscy60\\t(0,260,\\fscx100\\fscy100)\\fad(120,0)}}{esc(num)}"))
        ev += _karaoke(b, a, z, W // 2, 900, 50, 880)
    elif tipo == 'icone':
        ev += _titulo_secao(b, a, z, b.get('chave') or '')
        ev += _icone(b, a, z, W // 2, 610, tam=1.6)
        ev += _karaoke(b, a, z, W // 2, 990, 50, 880)
    elif tipo == 'imagem':
        ev += _titulo_secao(b, a, z, b.get('chave') or '')
        q = INSET_IMAGEM
        ev += _forma(a, z, caixa_arredondada(q['x'], q['y'], q['w'], q['h'], q['raio']), b['acento'], camada=2, contorno=3)
        # etiqueta com a palavra-chave em cima do vídeo (como o "grow it" verde da referência)
        tag = esc((b.get('chave') or '').lower())
        if tag:
            tw = int(len(tag) * 48 * 0.56) + 50; tx, ty = q['x'] + 40, q['y'] + q['h'] - 110
            ev += _forma(a, z, caixa_arredondada(tx, ty, tw, 76, 10), VERDE, camada=4, contorno=4)
            ev.append(_dlg(5, a, z, 'Sans', f"{{\\an4\\pos({tx + 25},{ty + 38})\\fs48{ENTRA}}}{tag}"))
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


def ass_final(blocos, palavras, duracao):
    """Camada de cima: legenda de UMA palavra por vez, @ do Pedro (muda de lugar com o layout) e a tela final."""
    linhas = []
    # @ do Pedro
    for b in blocos:
        a, z = b['t0'], b['t1']
        if b['layout'] == 'split':
            linhas += _logo_instagram(a, z, 990, 400, 44)
            linhas.append(_dlg(6, a, z, 'Sans', f"{{\\an6\\pos(1034,456)\\fs21\\fsp1}}{HANDLE}"))
        elif b['layout'] in ('rosto', 'broll'):
            linhas += _logo_instagram(a, z, 110, 1075, 50)
            linhas.append(_dlg(6, a, z, 'Sans', f"{{\\an4\\pos(80,1150)\\fs24\\fsp1}}{HANDLE}"))
    # tela final (chamada): escurece tudo, chamada no alto, logo grande e @
    fim = next((b for b in blocos if b['layout'] == 'fim'), None)
    if fim:
        a, z = fim['t0'], fim['t1']
        linhas.append(_dlg(5, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c&H000000&\\alpha&HFF&\\t(0,400,\\alpha&H30&)\\bord0\\p1}}m 0 0 l {W} 0 l {W} {H} l 0 {H}{{\\p0}}"))
        partes = fim['texto'].strip().rstrip('.!').split()
        corte = min(len(partes), 3)
        l1, l2 = ' '.join(partes[:corte]), ' '.join(partes[corte:corte + 6])
        linhas.append(_dlg(7, a, z, 'Sans', f"{{\\an5\\pos({W // 2},{330})\\fs70{ENTRA}}}{esc(l1)}"))
        if l2:
            linhas.append(_dlg(7, a, z, 'Serif', f"{{\\an5\\pos({W // 2},{420})\\fs84\\blur16\\alpha&HFF&\\t(200,500,\\blur0\\alpha&H00&)}}{esc(l2)}"))
        linhas += _logo_instagram(a + 0.2, z, W // 2, 820, 220, cor=ROSA, camada=8, glow=True)
        linhas.append(_dlg(8, a + 0.3, z, 'Sans', f"{{\\an5\\pos({W // 2},{1010})\\fs50\\fsp2{ENTRA}}}{HANDLE}"))
    if not fim and blocos and duracao > 8:
        a, z = max(blocos[-1]['t0'], duracao - 1.6), duracao
        linhas.append(_dlg(5, a, z, 'Forma', f"{{\\pos(0,0)\\an7\\c&H000000&\\alpha&HFF&\\t(0,300,\\alpha&H28&)\\bord0\\p1}}m 0 0 l {W} 0 l {W} {H} l 0 {H}{{\\p0}}"))
        linhas += _logo_instagram(a + 0.1, z, W // 2, 820, 200, cor=ROSA, camada=8, glow=True)
        linhas.append(_dlg(8, a + 0.2, z, 'Sans', f"{{\\an5\\pos({W // 2},{1000})\\fs48\\fsp2{ENTRA}}}{HANDLE}"))
    # legenda: uma palavra por vez
    for i, p in enumerate(palavras):
        ini = p['n0']; fim_p = palavras[i + 1]['n0'] if i + 1 < len(palavras) else min(duracao, p['n1'] + 0.4)
        if fim_p - ini < 0.04:
            continue
        lay = layout_em(blocos, ini + 0.01)
        y = Y_LEGENDA.get(lay, 1290)
        linhas.append(_dlg(9, ini, fim_p, 'Legenda', f"{{\\an5\\pos({W // 2},{y})\\fscx92\\fscy92\\t(0,90,\\fscx100\\fscy100)}}{esc(p['w'].strip())}"))
    return cabecalho() + '\n'.join(linhas) + '\n'


def trocas(blocos):
    return [b['t0'] for i, b in enumerate(blocos) if i and (b['layout'] != blocos[i - 1]['layout'] or b['tipo'] != blocos[i - 1]['tipo'])]
