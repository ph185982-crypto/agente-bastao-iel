"""Montagem dinâmica do reel (sem IA): plano frase a frase + gráficos animados em ASS.

Layouts (decididos pelas frases da transcrição já na linha do tempo final):
  - 'rosto'    : o Pedro em tela cheia 9:16 (gancho e frases de opinião), com punch-in alternado.
  - 'dividida' : tela dividida — em cima (1080x960) um quadro animado com a palavra-chave da frase e um desenho que
                 "se desenha" (seta, X, check, cifrão, alvo, lâmpada…) ou um b-roll; embaixo (1080x960) o rosto.
  - 'cartao'   : cartão cheio (1080x1920) com um número/destaque grande, curto (≤ 2,8 s), no máximo 1 a cada 15 s.
Regras de ritmo (pesquisa de vídeo curto): algo muda na tela a cada ~2,5–4 s; o gancho (1ª frase) é rosto; nunca dois
cartões seguidos; frase longa é partida no meio para não passar de ~4 s no mesmo layout.
"""
import re

LARGURA, ALTURA, METADE = 1080, 1920, 960
MAX_BLOCO = 4.0          # segundos máximos no mesmo layout
MIN_BLOCO = 1.2          # bloco menor que isso se junta ao vizinho
CARTAO_MAX = 2.8
CARTAO_INTERVALO = 15.0
PADRAO = ['dividida', 'rosto', 'dividida', 'cartao', 'rosto']

STOP = set('''a o e é de da do das dos em no na nos nas um uma uns umas que se não sim eu tu ele ela nós eles elas
meu minha seu sua seus suas nosso nossa isso isto aquilo esse essa este esta aquele aquela para pra por pelo pela com
sem mais menos muito muita muitos muitas pouco já também só ainda quando onde como porque porquê qual quais quem
lhe lhes me te nos vos ao aos à às ou mas então tá né vai vou foi ser ter tem era está estão estava você vocês dela dele
deles delas há até sobre entre depois antes cada todo toda todos todas outro outra outros outras mesmo mesma coisa
coisas fazer faz fez qualquer porém sua seu'''.split())

NEGOCIO = r'dinheir|marca|client|preç|preco|lucr|investi|empres|negóci|negoci|venda|vend|produto|imposto|caixa|merc|loja|custo|margem|salári|salari|dívida|divida|crédito|credito|juros|sucesso|qualidade|estratég|estrateg|foco|resultado|milh|bilh|cresc|gigant|riqueza|liberdade|governo|taxa|multa|lição|licao|segredo'
VERBOS = r'(ar|er|ir|ou|eu|iu|ava|ava|ando|endo|indo|ado|ido|ará|erá|irá|aram|eram|iram|amos|emos|imos)$'

ICONES = [
    ('dinheiro', r'r\$|dinheiro|investi|preço|preco|pagar|pagava|pago|lucro|faturamento|fatura|milh|bilh|caixa|vend'),
    ('seta_cima', r'cresc|aument|gigant|maior|subi|escal|explod|dobr|ganh|sucesso|marca'),
    ('x', r'\bnão\b|\bnunca\b|\bsem\b|erro|errado|perd|prejuízo|prejuizo|cuidado|problema|pior|proib'),
    ('alvo', r'\bfoco|focou|focar|objetivo|meta\b|estratég|estrateg|plano'),
    ('lampada', r'ideia|lição|licao|segredo|aprend|descobr|entend|truque|dica'),
    ('check', r'prov|certo|funcion|resultado|consegu|feito|pronto|verdade'),
    ('relogio', r'tempo|hora|minuto|dia\b|dias\b|anos?\b|rápido|rapido|prazo'),
]


def _limpa(w):
    return re.sub(r'[^\wÀ-ÿ$%]', '', w or '', flags=re.U)


def palavra_chave(texto, maximo=2):
    """Número (R$, %, dígitos) primeiro; senão as 1–2 palavras mais longas que não são de ligação, na ordem da frase."""
    t = texto or ''
    num = re.search(r'(R\$\s?[\d.,]+(?:\s?(?:mil|milhões|milhão|bi|bilhões))?|\d+[\d.,]*\s?%|\d+[\d.,]*\s?(?:mil|milhões|milhão|anos|dias|vezes|x)?)', t, re.I)
    if num and re.search(r'\d', num.group(0)):
        return num.group(0).strip().upper()
    palavras = [_limpa(w) for w in t.split()]
    cand = [(i, w) for i, w in enumerate(palavras) if len(w) >= 4 and w.lower() not in STOP and not re.search(VERBOS, w.lower())]
    if not cand:
        cand = [(i, w) for i, w in enumerate(palavras) if len(w) >= 4 and w.lower() not in STOP]
    if not cand:
        return ''
    # palavra de negócio ganha (é a que o público reconhece); depois a mais longa. Uma palavra só fica mais forte na tela.
    def peso(x):
        w = x[1].lower()
        return (2 if re.search(NEGOCIO, w) else 0) + min(len(w), 12) / 12
    melhor = max(cand, key=peso)
    return melhor[1].upper()


def icone(texto):
    t = (texto or '').lower()
    if '?' in t:
        return 'pergunta'
    for nome, rx in ICONES:
        if re.search(rx, t):
            return nome
    return 'estrela'


def tem_numero(texto):
    return bool(re.search(r'\d', texto or ''))


def _partir(frase):
    """Frase longa → duas metades na palavra mais perto do meio (usa os tempos das palavras quando existem)."""
    pal = frase.get('palavras') or []
    if len(pal) < 4:
        meio = (frase['n0'] + frase['n1']) / 2
        return [dict(frase, n1=meio), dict(frase, n0=meio)]
    alvo = (frase['n0'] + frase['n1']) / 2
    k = min(range(1, len(pal)), key=lambda i: abs(pal[i]['n0'] - alvo))
    a = {'n0': frase['n0'], 'n1': pal[k]['n0'], 'texto': ' '.join(p['w'] for p in pal[:k]), 'palavras': pal[:k]}
    b = {'n0': pal[k]['n0'], 'n1': frase['n1'], 'texto': ' '.join(p['w'] for p in pal[k:]), 'palavras': pal[k:]}
    return [a, b]


def planejar_blocos(frases, duracao):
    """frases [{n0,n1,texto,(palavras)}] na linha final → blocos contíguos [{t0,t1,layout,chave,icone,texto}]."""
    duracao = float(duracao)
    if not frases:
        return [{'t0': 0.0, 't1': duracao, 'layout': 'rosto', 'chave': '', 'icone': 'estrela', 'texto': ''}]
    partes = []
    for f in sorted(frases, key=lambda f: f['n0']):
        fila = [f]
        while fila:
            x = fila.pop(0)
            if x['n1'] - x['n0'] > MAX_BLOCO and len((x.get('texto') or '').split()) >= 4:
                fila = _partir(x) + fila
            else:
                partes.append(x)
    # junta pedaços curtos demais no anterior
    juntas = []
    for x in partes:
        if juntas and (x['n1'] - x['n0'] < MIN_BLOCO or juntas[-1]['n1'] - juntas[-1]['n0'] < MIN_BLOCO) and (x['n1'] - juntas[-1]['n0']) <= MAX_BLOCO + 1:
            j = juntas[-1]; juntas[-1] = {'n0': j['n0'], 'n1': x['n1'], 'texto': f"{j.get('texto', '')} {x.get('texto', '')}".strip(), 'palavras': (j.get('palavras') or []) + (x.get('palavras') or [])}
        else:
            juntas.append(dict(x))
    blocos = []; k = 0; ultimo_cartao = -999.0
    for i, x in enumerate(juntas):
        t0 = 0.0 if i == 0 else round(x['n0'], 3)
        t1 = duracao if i == len(juntas) - 1 else round(juntas[i + 1]['n0'], 3)
        if t1 - t0 < 0.05:
            continue
        texto = x.get('texto') or ''
        if i == 0:
            layout = 'rosto'                                  # gancho: o rosto do Pedro, olho no olho
        else:
            layout = PADRAO[k % len(PADRAO)]; k += 1
            if layout == 'cartao' and not ((t1 - t0) <= CARTAO_MAX or tem_numero(texto)) or (layout == 'cartao' and t0 - ultimo_cartao < CARTAO_INTERVALO):
                layout = 'rosto'
            if blocos and layout == blocos[-1]['layout']:
                layout = 'dividida' if layout != 'dividida' else 'rosto'
        if layout == 'cartao':
            ultimo_cartao = t0
        blocos.append({'t0': t0, 't1': t1, 'layout': layout, 'chave': palavra_chave(texto) or 'ATENÇÃO', 'icone': icone(texto), 'texto': texto})
    # cartão longo vira dividida (o Pedro não some da tela por muito tempo)
    for b in blocos:
        if b['layout'] == 'cartao' and b['t1'] - b['t0'] > CARTAO_MAX + 0.8:
            b['layout'] = 'dividida'
    return blocos


def layout_em(blocos, t):
    for b in blocos:
        if b['t0'] <= t < b['t1']:
            return b['layout']
    return blocos[-1]['layout'] if blocos else 'rosto'


def posicao_legenda(blocos):
    """Onde a legenda fica em cada layout (tags ASS): rosto = terço de baixo; dividida = na emenda das telas; cartão = abaixo do destaque."""
    def pos(t):
        lay = layout_em(blocos, t)
        if lay == 'dividida':
            return '\\an5\\pos(540,960)'
        if lay == 'cartao':
            return '\\an5\\pos(540,1340)'
        return '\\an2\\pos(540,1360)'
    return pos


# ── Gráficos em ASS ───────────────────────────────────────────────────────────────────────────────────────────────
def _t(s):
    s = max(0.0, float(s)); h = int(s // 3600); m = int(s % 3600 // 60)
    return f"{h}:{m:02d}:{s % 60:05.2f}"


def _esc(s):
    return (s or '').replace('\\', '').replace('{', '(').replace('}', ')')


# Desenhos vetoriais (ASS \p1), feitos para uma caixa de ~240 px. Cor por \c / \3c.
DESENHOS = {
    'seta_cima': 'm 120 0 l 240 130 l 165 130 l 165 240 l 75 240 l 75 130 l 0 130',
    'x': 'm 30 0 l 120 90 l 210 0 l 240 30 l 150 120 l 240 210 l 210 240 l 120 150 l 30 240 l 0 210 l 90 120 l 0 30',
    'check': 'm 0 130 l 40 90 l 95 145 l 200 20 l 240 60 l 95 225',
    'alvo': 'm 120 0 b 186 0 240 54 240 120 b 240 186 186 240 120 240 b 54 240 0 186 0 120 b 0 54 54 0 120 0 m 120 50 b 81 50 50 81 50 120 b 50 159 81 190 120 190 b 159 190 190 159 190 120 b 190 81 159 50 120 50',
    'lampada': 'm 120 0 b 190 0 240 50 240 115 b 240 160 215 185 190 205 l 190 240 l 50 240 l 50 205 b 25 185 0 160 0 115 b 0 50 50 0 120 0',
    'relogio': 'm 120 0 b 186 0 240 54 240 120 b 240 186 186 240 120 240 b 54 240 0 186 0 120 b 0 54 54 0 120 0 m 110 40 l 130 40 l 130 115 l 185 150 l 175 168 l 110 128',
    'estrela': 'm 120 0 l 150 85 l 240 88 l 168 142 l 195 230 l 120 178 l 45 230 l 72 142 l 0 88 l 90 85',
}
SIMBOLOS = {'dinheiro': 'R$', 'pergunta': '?'}
AMARELO = '&H0047E0FD&'; BRANCO = '&H00FFFFFF&'; GRAFITE = '&H001D1918&'; LARANJA = '&H004370FF&'


def cabecalho_graficos(largura, altura):
    return ("[Script Info]\nScriptType: v4.00+\n"
            f"PlayResX: {largura}\nPlayResY: {altura}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n"
            "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
            "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            "Style: Chave,Poppins ExtraBold,110,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1\n"
            "Style: Desenho,Arial,20,&H0047E0FD,&H0047E0FD,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n"
            "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")


FUNDOS = ['&H001D1918&', '&H00FF4824&']   # grafite e o azul da marca (#2448FF), alternando entre quadros


def _evento_quadro(b, largura, altura, grande=False, k=0):
    """Um quadro animado: desenho que se 'desenha' (clip abrindo da esquerda), palavra-chave com pop e um traço que cresce."""
    a, z = _t(b['t0']), _t(b['t1'])
    ev = [f"Dialogue: 0,{a},{z},Desenho,,0,0,0,,{{\\an7\\pos(0,0)\\c{FUNDOS[k % len(FUNDOS)]}\\bord0\\shad0\\p1}}m 0 0 l {largura} 0 l {largura} {altura} l 0 {altura}{{\\p0}}"]
    cx = largura // 2
    ytxt = int(altura * (0.62 if not grande else 0.58))
    # 1) desenho/símbolo
    ic = b.get('icone') or 'estrela'
    tam = 1.6 if grande else 1.0
    if ic in SIMBOLOS:
        fs = int(260 * tam)
        ev.append(f"Dialogue: 1,{a},{z},Chave,,0,0,0,,{{\\an5\\pos({cx},{int(altura * 0.30)})\\fs{fs}\\c{AMARELO}\\fscx40\\fscy40\\t(0,260,\\fscx100\\fscy100)\\fad(60,80)}}{SIMBOLOS[ic]}")
    else:
        w = int(240 * tam); x0 = cx - w // 2; y0 = int(altura * 0.30) - w // 2
        cor = LARANJA if ic == 'x' else AMARELO
        # o clip abre da esquerda para a direita em 450 ms: parece desenhado na hora
        ev.append(f"Dialogue: 1,{a},{z},Desenho,,0,0,0,,{{\\an7\\pos({x0},{y0})\\fscx{int(100 * tam)}\\fscy{int(100 * tam)}\\c{cor}\\bord0\\shad0"
                  f"\\clip({x0},{y0 - 10},{x0},{y0 + w + 10})\\t(0,450,\\clip({x0},{y0 - 10},{x0 + w + 10},{y0 + w + 10}))\\fad(0,80)\\p1}}{DESENHOS.get(ic, DESENHOS['estrela'])}{{\\p0}}")
    # 2) palavra-chave com pop (entra 150 ms depois do desenho)
    chave = _esc(b.get('chave') or '')
    if chave:
        fs = 190 if grande and len(chave) <= 10 else 150 if len(chave) <= 9 else 124 if len(chave) <= 13 else 96
        ev.append(f"Dialogue: 2,{a},{z},Chave,,0,0,0,,{{\\an5\\pos({cx},{ytxt})\\fs{fs}\\alpha&HFF&\\fscx70\\fscy70\\t(150,300,\\alpha&H00&\\fscx100\\fscy100)\\fad(0,80)}}{chave}")
        # 3) traço amarelo que cresce embaixo da palavra
        wt = min(largura - 160, int(len(chave) * fs * 0.62)); xt = cx - wt // 2; yt = ytxt + int(fs * 0.62)
        ev.append(f"Dialogue: 1,{a},{z},Desenho,,0,0,0,,{{\\an7\\pos({xt},{yt})\\c{AMARELO}\\fscx0\\t(300,650,\\fscx100)\\fad(0,80)\\p1}}m 0 0 l {wt} 0 l {wt} 14 l 0 14{{\\p0}}")
    return ev


def ass_graficos(blocos, area='topo'):
    """ASS dos quadros: area='topo' (1080x960, blocos 'dividida') ou 'cheio' (1080x1920, blocos 'cartao')."""
    largura, altura = (LARGURA, METADE) if area == 'topo' else (LARGURA, ALTURA)
    alvo = 'dividida' if area == 'topo' else 'cartao'
    linhas = []; k = 0
    for b in blocos:
        if b['layout'] == alvo and not b.get('broll'):
            linhas += _evento_quadro(b, largura, altura, grande=(area == 'cheio'), k=k); k += 1
        elif b['layout'] == alvo and b.get('broll') and b.get('chave'):
            # sobre o b-roll: só a palavra-chave numa faixa escura, para não brigar com a imagem
            a, z = _t(b['t0']), _t(b['t1'])
            linhas.append(f"Dialogue: 2,{a},{z},Chave,,0,0,0,,{{\\an2\\pos({largura // 2},{altura - 70})\\fs90\\bord0\\shad0\\3c&H000000&\\4c&H000000&\\fscx80\\fscy80\\t(0,180,\\fscx100\\fscy100)}}{_esc(b['chave'])}")
    return cabecalho_graficos(largura, altura) + '\n'.join(linhas) + '\n'


def trocas(blocos):
    """Instantes em que o layout muda (para o 'whoosh' discreto)."""
    return [b['t0'] for i, b in enumerate(blocos) if i and b['layout'] != blocos[i - 1]['layout']]
