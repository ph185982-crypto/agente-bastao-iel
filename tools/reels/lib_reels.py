#!/usr/bin/env python3
"""Funções puras do editor de reels (sem ffmpeg, sem rede, sem disco): dá para testar cada uma isolada.

Convenções:
- "palavra" é um dict {t0, t1, w, seg} com tempos em segundos no vídeo ORIGINAL; `seg` é o índice da frase
  (segmento do Whisper) de onde ela veio.
- "intervalo" é uma lista/tupla (a, b) com a < b, em segundos.
- "trechos" é a lista ordenada e sem sobreposição dos intervalos do original que FICAM no vídeo final.
- Depois de `remapear_tempos`, cada palavra ganha `n0`/`n1`: o tempo dela no vídeo final.
"""
import difflib
import json
import math
import re
import unicodedata

# ----------------------------------------------------------------------------------------------------------------------
# Constantes do contrato (docs/VIDEOS_E_RECICLAGEM_SPEC.md → "Worker de edição")
# ----------------------------------------------------------------------------------------------------------------------
MULETAS = {'é', 'éé', 'ééé', 'hã', 'ã', 'hum', 'ahn', 'né', 'hm', 'hmm', 'ahm', 'eh', 'ééh'}
PAUSA_MULETA = 0.15       # muleta só sai se estiver isolada por pausa ≥ 150 ms dos dois lados
MARGEM_SILENCIO = 0.15    # sobra de silêncio que fica em cada lado da fala
PROTEGER_INICIO = 1.0     # sem transcrição (corte por silêncio): nunca cortar o 1º segundo
RETOMADA_MIN_PALAVRAS = 3
RETOMADA_JANELA = 6.0
ZOOMS_PUNCH_IN = (1.0, 1.08)   # punch-in discreto: 12% chamava atenção demais
LARGURA, ALTURA = 1080, 1920
MARGEM_V = 560            # legenda acima da interface do Reels

# Presets de legenda. Cores em ASS são &HAABBGGRR (alfa 00 = opaco).
PRESETS = {
    'hormozi': {
        'fonte': 'Poppins ExtraBold', 'tamanho': 96, 'maiusculas': True,
        'cor': '&H00FFFFFF', 'cor_ativa': '&H0047E0FD',      # branco; palavra ativa amarela #FDE047
        'contorno': '&H00000000', 'fundo': '&H80000000',
        'borda_estilo': 1, 'contorno_px': 5, 'sombra_px': 4, 'escala_ativa': 110,
        'min_palavras': 3, 'max_palavras': 4, 'max_chars': 26, 'fator_largura': 0.64,
    },
    'beast': {
        'fonte': 'Anton', 'tamanho': 100, 'maiusculas': True,
        'cor': '&H0000D7FF', 'cor_ativa': '&H00FFFFFF',      # amarelo #FFD700; palavra ativa branca
        'contorno': '&H00000000', 'fundo': '&H00000000',
        'borda_estilo': 1, 'contorno_px': 9, 'sombra_px': 0, 'escala_ativa': 110,
        'min_palavras': 1, 'max_palavras': 3, 'max_chars': 18, 'fator_largura': 0.47,
    },
    'caixa': {
        'fonte': 'Inter', 'tamanho': 84, 'maiusculas': False, 'negrito': -1,
        'cor': '&H00FFFFFF', 'cor_ativa': '&H0047E0FD',      # branco sobre caixa preta; ativa amarela
        'contorno': '&H59000000', 'fundo': '&H59000000',     # caixa preta 65% (alfa 0x59 = 35% transparente)
        'borda_estilo': 3, 'contorno_px': 14, 'sombra_px': 0, 'escala_ativa': 100,
        'min_palavras': 4, 'max_palavras': 6, 'max_chars': 36, 'fator_largura': 0.56,
    },
}

# Palavras-chave PT → EN para o b-roll do Pexels (lista simples, sem IA)
PALAVRAS_CHAVE_EN = {
    'governo': 'government building', 'dinheiro': 'money', 'economia': 'economy city', 'imposto': 'taxes money',
    'impostos': 'taxes money', 'empresa': 'business office', 'empresas': 'business office', 'trabalho': 'work office',
    'trabalhador': 'worker', 'brasil': 'brazil city', 'cidade': 'city skyline', 'família': 'family',
    'escola': 'school classroom', 'casa': 'house', 'carro': 'car traffic', 'comida': 'food market',
    'energia': 'energy power lines', 'petróleo': 'oil industry', 'banco': 'bank building', 'mercado': 'market',
    'político': 'politician speech', 'políticos': 'politician speech', 'congresso': 'parliament building',
    'eleição': 'election vote', 'eleições': 'election vote', 'voto': 'election vote', 'polícia': 'police',
    'crime': 'city night', 'saúde': 'hospital', 'hospital': 'hospital', 'estrada': 'highway',
    'indústria': 'factory industry', 'fábrica': 'factory industry', 'agro': 'farm harvest', 'agronegócio': 'farm harvest',
    'fazenda': 'farm', 'campo': 'farm field', 'inflação': 'supermarket prices', 'preço': 'supermarket prices',
    'preços': 'supermarket prices', 'salário': 'money wallet', 'emprego': 'office work', 'desemprego': 'unemployment',
    'liberdade': 'open road freedom', 'justiça': 'courthouse', 'lei': 'courthouse', 'leis': 'courthouse',
    'tecnologia': 'technology', 'internet': 'computer typing', 'celular': 'smartphone', 'tv': 'television',
    'jornal': 'newspaper', 'notícia': 'newspaper', 'mídia': 'news studio', 'escola pública': 'school',
    'universidade': 'university campus', 'professor': 'teacher classroom', 'aluno': 'students',
    'rua': 'city street', 'praia': 'beach', 'são paulo': 'sao paulo skyline', 'rio': 'rio de janeiro',
    'brasília': 'brasilia congress', 'china': 'china city', 'estados unidos': 'new york city', 'argentina': 'buenos aires',
    'europa': 'europe city', 'dólar': 'dollar bills', 'real': 'brazilian money', 'bolsa': 'stock market',
    'investimento': 'stock market', 'juros': 'bank finance', 'dívida': 'calculator bills', 'crise': 'storm city',
    'guerra': 'military', 'exército': 'military', 'igreja': 'church', 'deus': 'church light',
    'jovem': 'young people city', 'jovens': 'young people city', 'criança': 'children playing',
    'crianças': 'children playing', 'pobreza': 'poor neighborhood', 'favela': 'favela brazil', 'rico': 'luxury city',
}
STOPWORDS = set('''a o e é de da do das dos em no na nos nas um uma uns umas que se não sim eu tu ele ela nós vós eles elas
me te lhe nos vos meu minha seu sua teu tua nosso nossa este esta esse essa aquele aquela isto isso aquilo por para com sem
sobre entre até como mais menos muito pouco todo toda todos todas já ainda só também mas porém então porque quando onde quem
qual quais ser estar ter haver fazer ir vir dizer ver dar saber poder querer foi era são está estão tem têm vai vão tinha
aqui ali lá aí gente cara coisa coisas tipo assim né hã ã hum ahn ok tá bom boa bem mal dia hoje ontem amanhã ano anos
vez vezes agora depois antes sempre nunca nada tudo algo alguém ninguém cada outro outra outros outras mesmo mesma
pra pro pras pros num numa dum duma'''.split())


# ----------------------------------------------------------------------------------------------------------------------
# Texto
# ----------------------------------------------------------------------------------------------------------------------
def normalizar(palavra):
    """Minúsculas, sem pontuação nas pontas, sem espaços: serve para comparar palavras ('Eu,' == 'eu')."""
    s = (palavra or '').strip().lower()
    s = re.sub(r'^[^\wÀ-ÿ]+|[^\wÀ-ÿ]+$', '', s)
    return s


def sem_acentos(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def montar_initial_prompt(roteiro, max_palavras=200):
    """Roteiro (até 200 palavras) + muletas comuns, para o Whisper reconhecer nomes e marcar 'é… tipo, né'."""
    palavras = (roteiro or '').split()
    base = ' '.join(palavras[:max_palavras]).strip()
    muletas = 'É… tipo, né? Hã, então, assim…'
    return (base + ' ' + muletas).strip() if base else muletas


# ----------------------------------------------------------------------------------------------------------------------
# Intervalos
# ----------------------------------------------------------------------------------------------------------------------
def unir_intervalos(intervalos, folga=0.0):
    """Ordena e funde intervalos que se tocam ou se sobrepõem (ou estão a menos de `folga` um do outro)."""
    out = []
    for a, b in sorted((float(a), float(b)) for a, b in intervalos if b > a):
        if out and a <= out[-1][1] + folga:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [tuple(x) for x in out]


def subtrair_intervalos(mantidos, cortes):
    """Remove de `mantidos` tudo o que cai dentro de `cortes`."""
    cortes = unir_intervalos(cortes)
    out = []
    for a, b in unir_intervalos(mantidos):
        atual = a
        for c0, c1 in cortes:
            if c1 <= atual or c0 >= b:
                continue
            if c0 > atual:
                out.append((atual, min(c0, b)))
            atual = max(atual, c1)
            if atual >= b:
                break
        if atual < b:
            out.append((atual, b))
    return [(round(a, 3), round(b, 3)) for a, b in out if b - a > 1e-6]


def proteger_inicio(trechos, duracao, segundos=PROTEGER_INICIO):
    """Garante que o primeiro segundo do original está no vídeo final (nunca cortar o 1º segundo)."""
    fim = min(float(segundos), float(duracao))
    if fim <= 0:
        return list(trechos)
    return unir_intervalos(list(trechos) + [(0.0, fim)])


def limpar_trechos(trechos, min_duracao=0.12, folga_fusao=0.04):
    """Funde trechos separados por buracos ínfimos (não vale o corte) e descarta trechos minúsculos."""
    out = unir_intervalos(trechos, folga=folga_fusao)
    return [(a, b) for a, b in out if b - a >= min_duracao]


def duracao_total(trechos):
    return round(sum(b - a for a, b in trechos), 3)


# ----------------------------------------------------------------------------------------------------------------------
# Silêncios (saída do silencedetect do ffmpeg)
# ----------------------------------------------------------------------------------------------------------------------
def parse_silencedetect(log):
    """Lê 'silence_start: x' / 'silence_end: y' do stderr do ffmpeg e devolve [(ini, fim)]."""
    inicios = [float(m) for m in re.findall(r'silence_start:\s*(-?[\d.]+)', log)]
    fins = [float(m) for m in re.findall(r'silence_end:\s*(-?[\d.]+)', log)]
    pares = []
    for i, ini in enumerate(inicios):
        fim = fins[i] if i < len(fins) else None
        pares.append((max(0.0, ini), fim))
    return pares


def trechos_por_silencio(duracao, silencios, margem=MARGEM_SILENCIO):
    """A partir dos silêncios, devolve os trechos de fala mantidos, deixando `margem` de ar em cada lado."""
    duracao = float(duracao)
    cortes = []
    for ini, fim in silencios:
        # silêncio sem fim (vai até o final do arquivo) é cortado inteiro: não há fala depois
        a, b = ini + margem, (duracao if fim is None else fim - margem)
        if b - a > 0.02:
            cortes.append((a, b))
    return subtrair_intervalos([(0.0, duracao)], cortes)


# ----------------------------------------------------------------------------------------------------------------------
# Cortes guiados pelas palavras
# ----------------------------------------------------------------------------------------------------------------------
def _pausa_antes(palavras, i):
    return palavras[i]['t0'] - palavras[i - 1]['t1'] if i > 0 else 9.9


def _pausa_depois(palavras, i):
    return palavras[i + 1]['t0'] - palavras[i]['t1'] if i + 1 < len(palavras) else 9.9


def cortes_muletas(palavras, pausa_min=PAUSA_MULETA, muletas=MULETAS):
    """Muletas ('é', 'hã', 'né'…) isoladas por pausa ≥ pausa_min dos dois lados viram cortes."""
    cortes = []
    for i, p in enumerate(palavras):
        if normalizar(p['w']) not in muletas:
            continue
        antes, depois = _pausa_antes(palavras, i), _pausa_depois(palavras, i)
        if antes >= pausa_min and depois >= pausa_min:
            # leva junto metade das pausas vizinhas (até 120 ms) para a emenda ficar natural
            cortes.append((p['t0'] - min(antes / 2, 0.12), p['t1'] + min(depois / 2, 0.12)))
    return cortes


def cortes_repeticoes(palavras):
    """Palavras repetidas em sequência ('eu eu eu acho') → fica só a última."""
    cortes = []
    i = 0
    while i < len(palavras):
        j = i
        while j + 1 < len(palavras) and normalizar(palavras[j + 1]['w']) == normalizar(palavras[i]['w']) and normalizar(palavras[i]['w']):
            j += 1
        if j > i:
            cortes.append((palavras[i]['t0'], palavras[j]['t0']))
        i = j + 1
    return cortes


def detectar_retomadas(palavras, min_palavras=RETOMADA_MIN_PALAVRAS, janela=RETOMADA_JANELA):
    """Retomada: o Pedro erra e repete a frase. Uma sequência de ≥ min_palavras que reaparece em até `janela` s.
    Fica a ÚLTIMA ocorrência: devolve cortes do começo da 1ª até o começo da 2ª, e os índices das palavras cortadas."""
    norm = [normalizar(p['w']) for p in palavras]
    n = len(norm)
    cortes, indices = [], set()
    i = 0
    while i < n:
        achou = None
        # tenta a sequência mais longa primeiro (até 12 palavras), depois encurta
        for tam in range(min(12, n - i), min_palavras - 1, -1):
            seq = norm[i:i + tam]
            if not all(seq):
                continue
            for j in range(i + tam, n - tam + 1):
                if palavras[j]['t0'] - palavras[i]['t0'] > janela:
                    break
                if norm[j:j + tam] == seq:
                    achou = (j, tam)
                    break
            if achou:
                break
        if achou:
            j, tam = achou
            cortes.append((palavras[i]['t0'], palavras[j]['t0']))
            indices.update(range(i, j))
            i = j
        else:
            i += 1
    return cortes, sorted(indices)


# Cortes pelas PALAVRAS (não pelo volume): gravação baixa (rua, celular longe) tem fala abaixo de -35 dB e o corte por
# silêncio apagava frases inteiras. Aqui só sai o vão ENTRE palavras, e fica um respiro para soar humano.
FOLGA_INICIO = 0.12     # antes da 1ª palavra do trecho
FOLGA_PRIMEIRA = 0.25   # antes da 1ª palavra do VÍDEO: o vídeo começa já na fala (sem segundo mudo), sem comer a 1ª sílaba
FOLGA_FIM = 0.20        # depois da última (o Whisper costuma cortar o fim da palavra)
PAUSA_MAX = 0.55        # vão maior que isso é encurtado
RESPIRO = 0.30          # quanto do vão fica no meio da frase
RESPIRO_FRASE = 0.45    # quanto fica no fim de frase (ponto final): pausa natural


def trechos_por_palavras(palavras, duracao, folga_ini=FOLGA_INICIO, folga_fim=FOLGA_FIM, pausa_max=PAUSA_MAX,
                         respiro=RESPIRO, respiro_frase=RESPIRO_FRASE, folga_primeira=FOLGA_PRIMEIRA):
    """Palavras com t0/t1 → trechos mantidos. Nunca corta dentro de palavra; vão longo vira respiro curto."""
    duracao = float(duracao)
    pal = sorted((p for p in palavras if p.get('t1', 0) > p.get('t0', 0)), key=lambda p: p['t0'])
    if not pal:
        return [(0.0, duracao)]
    trechos = []
    ini = max(0.0, pal[0]['t0'] - max(folga_ini, folga_primeira))
    for a, b in zip(pal, pal[1:]):
        vao = b['t0'] - a['t1']
        if vao <= pausa_max:
            continue
        fim_frase = a['w'].rstrip().endswith(('.', '!', '?', ':'))
        guarda = respiro_frase if fim_frase else respiro
        # o respiro fica dividido: um pouco depois da palavra, um pouco antes da próxima
        fim = min(a['t1'] + max(folga_fim, guarda * 0.6), b['t0'])
        prox = max(b['t0'] - max(folga_ini, guarda * 0.4), fim)
        trechos.append((ini, fim))
        ini = prox
    trechos.append((ini, min(duracao, pal[-1]['t1'] + 0.35)))
    return [(round(a, 3), round(b, 3)) for a, b in trechos if b - a > 0.05]


def montar_trechos(duracao, silencios=(), palavras=(), remover_pausas=True, remover_muletas=True,
                   remover_retomadas=True, margem=MARGEM_SILENCIO):
    """Junta tudo: pausas (pelas palavras; silêncio só sem transcrição) ∪ muletas ∪ repetições ∪ retomadas → trechos."""
    duracao = float(duracao)
    if remover_pausas and palavras:
        mantidos = trechos_por_palavras(palavras, duracao)
    else:
        mantidos = trechos_por_silencio(duracao, silencios, margem) if remover_pausas else [(0.0, duracao)]
    detalhes = {'silencios': len([s for s in silencios]) if remover_pausas else 0, 'muletas': 0, 'repeticoes': 0, 'retomadas': 0}
    cortes = []
    if remover_muletas and palavras:
        m = cortes_muletas(palavras)
        detalhes['muletas'] = len(m)
        cortes += m
    if remover_retomadas and palavras:
        r = cortes_repeticoes(palavras)
        detalhes['repeticoes'] = len(r)
        cortes += r
        rt, _ = detectar_retomadas(palavras)
        detalhes['retomadas'] = len(rt)
        cortes += rt
    if cortes:
        mantidos = subtrair_intervalos(mantidos, cortes)
    if not (remover_pausas and palavras):   # com as palavras, o vídeo começa na 1ª fala (o segundo mudo do início derrubava a retenção)
        mantidos = proteger_inicio(mantidos, duracao)
    mantidos = limpar_trechos(mantidos)
    if not mantidos:
        mantidos = [(0.0, duracao)]
    detalhes['cortes'] = max(0, len(mantidos) - 1)
    # cortes intencionais: essas palavras não voltam na legenda (ver remapear_tempos)
    detalhes['cortes_palavras'] = [(round(a, 3), round(b, 3)) for a, b in unir_intervalos(cortes)]
    return mantidos, detalhes


# ----------------------------------------------------------------------------------------------------------------------
# Remapear tempos para a linha do tempo final
# ----------------------------------------------------------------------------------------------------------------------
def mapear_instante(t, trechos):
    """Tempo do original → tempo no final. Fora dos trechos, devolve None."""
    acum = 0.0
    for a, b in trechos:
        if a <= t <= b:
            return round(acum + (t - a), 3)
        acum += b - a
    return None


def remapear_tempos(palavras, trechos, cortes_intencionais=(), tolerancia=0.6):
    """Palavras cujo meio cai num trecho mantido ganham n0/n1 (tempo final).
    Palavras dentro de um corte intencional (muleta, repetição, retomada) somem.
    Palavras "órfãs" (caíram num corte de silêncio porque o Whisper errou o tempo de uma palavra curta) são
    encaixadas na borda do trecho vizinho, do lado da palavra seguinte/anterior da mesma frase, se estiver a
    menos de `tolerancia` s; senão somem."""
    mapa = []
    acum = 0.0
    for a, b in trechos:
        mapa.append((a, b, acum))
        acum += b - a

    def localizar(t):
        for i, (a, b, off) in enumerate(mapa):
            if a <= t <= b:
                return i
        return None

    marcados = []
    for p in palavras:
        meio = (p['t0'] + p['t1']) / 2
        if any(c0 <= meio <= c1 for c0, c1 in cortes_intencionais):
            marcados.append((p, 'fora', None))
            continue
        i = localizar(meio)
        marcados.append((p, 'dentro', i) if i is not None else (p, 'orfa', None))

    out = []
    for k, (p, estado, i) in enumerate(marcados):
        if estado == 'fora':
            continue
        q = dict(p)
        dur = min(max(p['t1'] - p['t0'], 0.08), 0.3)
        if estado == 'dentro':
            a, b, off = mapa[i]
            q['n0'] = round(off + max(p['t0'], a) - a, 3)
            q['n1'] = round(off + min(p['t1'], b) - a, 3)
        else:
            meio = (p['t0'] + p['t1']) / 2
            prox = marcados[k + 1] if k + 1 < len(marcados) else None
            ant = marcados[k - 1] if k > 0 else None
            destino = None
            # prefere o lado da palavra vizinha da mesma frase que ficou no vídeo
            if prox and prox[1] == 'dentro' and prox[0].get('seg') == p.get('seg') and mapa[prox[2]][0] - meio <= tolerancia:
                destino = ('inicio', prox[2])
            elif ant and ant[1] == 'dentro' and ant[0].get('seg') == p.get('seg') and meio - mapa[ant[2]][1] <= tolerancia:
                destino = ('fim', ant[2])
            else:
                cand = [(abs(a - meio), 'inicio', j) for j, (a, b, off) in enumerate(mapa)] + [(abs(meio - b), 'fim', j) for j, (a, b, off) in enumerate(mapa)]
                d, lado, j = min(cand)
                if d <= tolerancia:
                    destino = (lado, j)
            if destino is None:
                continue
            lado, j = destino
            a, b, off = mapa[j]
            if lado == 'inicio':
                q['n0'], q['n1'] = round(off, 3), round(off + dur, 3)
            else:
                q['n1'] = round(off + (b - a), 3)
                q['n0'] = round(q['n1'] - dur, 3)
            q['encaixada'] = True
        if q['n1'] <= q['n0']:
            q['n1'] = round(q['n0'] + 0.05, 3)
        out.append(q)
    # garante ordem e sem sobreposição depois dos encaixes
    out.sort(key=lambda w: w['n0'])
    for w0, w1 in zip(out, out[1:]):
        if w1['n0'] < w0['n1']:
            w0['n1'] = max(w0['n0'] + 0.01, w1['n0'])   # na legenda a palavra dura até a próxima começar, então basta não invadir
    return out


def frases_remapeadas(palavras_remapeadas):
    """Reagrupa as palavras (já com n0/n1) por frase original → [{t0, t1, texto}] no tempo final."""
    frases = []
    atual = None
    for p in palavras_remapeadas:
        seg = p.get('seg', 0)
        if atual is None or atual['seg'] != seg:
            atual = {'seg': seg, 't0': p['n0'], 't1': p['n1'], 'palavras': [p['w'].strip()]}
            frases.append(atual)
        else:
            atual['t1'] = p['n1']
            atual['palavras'].append(p['w'].strip())
    return [{'t0': f['t0'], 't1': f['t1'], 'texto': ' '.join(f['palavras'])} for f in frases]


# ----------------------------------------------------------------------------------------------------------------------
# Punch-in: um zoom fixo por frase, alternando 1,0× / 1,12×
# ----------------------------------------------------------------------------------------------------------------------
def dividir_trechos(trechos, instantes):
    """Divide os trechos nos instantes dados (tempo do original), sem mudar o conteúdo. Útil para o punch-in."""
    pontos = sorted(set(float(t) for t in instantes))
    out = []
    for a, b in trechos:
        atual = a
        for t in pontos:
            if atual + 0.08 < t < b - 0.08:
                out.append((atual, t))
                atual = t
        out.append((atual, b))
    return out


def planejar_segmentos(trechos, inicios_frases=(), punch_in=True, zooms=ZOOMS_PUNCH_IN):
    """Transforma trechos em segmentos de render: {a, b, zoom, fade_in, fade_out}.
    fade_in/fade_out só nas emendas reais (jump cuts), nunca nas divisões por frase."""
    inicios = sorted(float(t) for t in inicios_frases) if punch_in else []
    partes = dividir_trechos(trechos, inicios) if inicios else list(trechos)
    segs = []
    for i, (a, b) in enumerate(partes):
        zoom = 1.0
        if punch_in and inicios:
            # frase "dona" do segmento = a última que começou até o meio dele
            meio = (a + b) / 2
            idx = sum(1 for t in inicios if t <= meio) - 1
            zoom = zooms[max(idx, 0) % len(zooms)]
        fade_in = i == 0 or abs(partes[i - 1][1] - a) > 1e-6
        fade_out = i == len(partes) - 1 or abs(partes[i + 1][0] - b) > 1e-6
        segs.append({'a': round(a, 3), 'b': round(b, 3), 'zoom': zoom, 'fade_in': fade_in, 'fade_out': fade_out})
    return segs


# ----------------------------------------------------------------------------------------------------------------------
# Enquadramento: suavizar o centro do rosto e fixar um crop por segmento
# ----------------------------------------------------------------------------------------------------------------------
def suavizar_centros(centros, alpha=0.85, zona_morta=0.03, passo_max=0.02, inicial=0.5):
    """EMA (alpha no valor anterior) + zona morta + limite de passo. `centros` pode ter None (sem rosto): mantém."""
    s = None
    out = []
    for c in centros:
        if c is None:
            out.append(s if s is not None else inicial)
            continue
        if s is None:
            s = float(c)
        else:
            if abs(c - s) >= zona_morta:
                alvo = alpha * s + (1 - alpha) * c
                delta = max(-passo_max, min(passo_max, alvo - s))
                s = s + delta
        out.append(round(s, 4))
    return out


def centro_por_segmento(amostras, segmentos, padrao=0.5):
    """`amostras` = [(t, cx, cy)] no tempo original. Devolve, por segmento, o centro médio (fixo entre jump cuts)."""
    out = []
    for seg in segmentos:
        dentro = [(cx, cy) for t, cx, cy in amostras if seg['a'] <= t <= seg['b']]
        if not dentro:
            # pega a amostra mais perto do meio do segmento
            meio = (seg['a'] + seg['b']) / 2
            if amostras:
                t, cx, cy = min(amostras, key=lambda s: abs(s[0] - meio))
                dentro = [(cx, cy)]
        if dentro:
            out.append((round(sum(d[0] for d in dentro) / len(dentro), 4), round(sum(d[1] for d in dentro) / len(dentro), 4)))
        else:
            out.append((padrao, padrao))
    return out


def geometria_crop(largura, altura, zoom=1.0, cx=0.5, cy=0.5, alvo_l=LARGURA, alvo_a=ALTURA):
    """Escala a fonte para cobrir 1080x1920 (vezes o zoom) e recorta centrado em (cx, cy). Devolve (w, h, x, y)."""
    f = max(alvo_l / largura, alvo_a / altura) * zoom
    w = int(math.ceil(largura * f / 2) * 2)
    h = int(math.ceil(altura * f / 2) * 2)
    w, h = max(w, alvo_l), max(h, alvo_a)
    x = int(round(cx * w - alvo_l / 2))
    y = int(round(cy * h - alvo_a / 2))
    x = max(0, min(w - alvo_l, x))
    y = max(0, min(h - alvo_a, y))
    return w, h, x, y


# ----------------------------------------------------------------------------------------------------------------------
# Rastreio do rosto quadro a quadro: o recorte acompanha o rosto dentro de cada trecho (não fica parado no centro médio)
# ----------------------------------------------------------------------------------------------------------------------
def _interp(xs, ys, x):
    """Interpolação linear com as pontas seguras (igual a numpy.interp). `xs` crescente."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    lo, hi = 0, len(xs) - 1
    while hi - lo > 1:
        meio = (lo + hi) // 2
        if xs[meio] <= x:
            lo = meio
        else:
            hi = meio
    if xs[hi] == xs[lo]:
        return ys[lo]
    return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo])


def trilha_rosto(cru, sigma_s=0.5, mediana=5):
    """`cru` = [(t, cx|None, cy|None, ...)] no tempo ORIGINAL, cx/cy normalizados 0..1 (None = rosto não achado).
    Devolve {'t', 'cx', 'cy'}: buracos preenchidos por interpolação (pontas seguras), picos de detecção falsa tirados
    (mediana móvel) e movimento suave SEM atraso (gaussiana de fase zero, σ = sigma_s s), como um operador de câmera
    calmo. None se nenhuma amostra tem rosto."""
    ts = [float(c[0]) for c in cru]
    if not ts:
        return None

    def serie(k):
        pts = [(float(c[0]), float(c[k])) for c in cru if c[k] is not None]
        if not pts:
            return None
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        v = [_interp(xs, ys, t) for t in ts]
        h = mediana // 2
        if h and len(v) > 2:
            pad = [v[0]] * h + v + [v[-1]] * h
            v = [sorted(pad[i:i + 2 * h + 1])[h] for i in range(len(v))]
        dt = (ts[-1] - ts[0]) / (len(ts) - 1) if len(ts) > 1 else 0
        if dt <= 0:
            return [round(x, 5) for x in v]
        s = max(0.5, sigma_s / dt)
        r = int(3 * s)
        nucleo = [math.exp(-0.5 * (j / s) ** 2) for j in range(-r, r + 1)]
        soma = sum(nucleo)
        pad = [v[0]] * r + v + [v[-1]] * r
        return [round(sum(nucleo[j] * pad[i + j] for j in range(2 * r + 1)) / soma, 5) for i in range(len(v))]

    cx, cy = serie(1), serie(2)
    if cx is None or cy is None:
        return None
    return {'t': ts, 'cx': cx, 'cy': cy}


def posicao_na_trilha(trilha, t):
    """(cx, cy) do rosto no instante t (tempo original), interpolado na trilha."""
    return _interp(trilha['t'], trilha['cx'], t), _interp(trilha['t'], trilha['cy'], t)


def expr_linear(pontos, casas=1):
    """[(t, v)] com t crescente → expressão do ffmpeg na variável t, linear por partes e segura antes do 1º e depois do
    último ponto: v0 + Σ Δv·clip((t − tᵢ)/(tᵢ₊₁ − tᵢ), 0, 1). Vai entre aspas simples no filtro (tem vírgulas)."""
    vals = [(float(t), round(float(v), casas)) for t, v in pontos]
    out = [f"{vals[0][1]:.{casas}f}"]
    for (ta, va), (tb, vb) in zip(vals, vals[1:]):
        dv = round(vb - va, casas)
        if abs(dv) < 0.5 * 10 ** -casas or tb - ta <= 1e-6:
            continue
        out.append(f"{'+' if dv > 0 else '-'}{abs(dv):.{casas}f}*clip((t-{ta:.3f})/{tb - ta:.3f},0,1)")
    return ''.join(out)


def chaves_crop(trilha, a, b, larg, alt, corte_l, corte_a, alvo_x, alvo_y, topo=0, passo=0.25):
    """Recorte que segue o rosto no trecho [a, b] da fonte (tempo original). A fonte já escalada mede larg×alt e ganha
    `topo` linhas de preenchimento em cima (a cabeça pode passar da borda de cima); o recorte mede corte_l×corte_a e
    põe o rosto em (alvo_x, alvo_y) dele, sempre dentro dos limites. Sem trilha: rosto suposto em (0,5; 0,45).
    Devolve (expr_x, expr_y) no tempo LOCAL do segmento (0 = início dele)."""
    n = max(1, int(math.ceil((b - a) / passo - 1e-9)))
    px, py = [], []
    for k in range(n + 1):
        t = a + (b - a) * k / n
        cx, cy = posicao_na_trilha(trilha, t) if trilha else (0.5, 0.45)
        x = min(max(cx * larg - alvo_x, 0), max(0, larg - corte_l))
        y = min(max(cy * alt + topo - alvo_y, 0), max(0, alt + topo - corte_a))
        px.append((t - a, x))
        py.append((t - a, y))
    return expr_linear(px), expr_linear(py)


def filtro_rotacao_legado(rotacao):
    """Rotação do ffprobe (side_data 'rotation', convenção: -90 = gravar deitado precisa girar horário) → filtro."""
    r = int(round(float(rotacao or 0))) % 360  # não usar: o sinal muda entre versões do ffmpeg (5.0 inverteu)
    if r == 270:      # -90
        return 'transpose=1'
    if r == 90:
        return 'transpose=2'
    if r == 180:
        return 'transpose=1,transpose=1'
    return ''


# ----------------------------------------------------------------------------------------------------------------------
# Legendas
# ----------------------------------------------------------------------------------------------------------------------
def agrupar_palavras(palavras, max_palavras=4, max_chars=26, min_palavras=1, pausa_quebra=0.6):
    """Agrupa palavras (com n0/n1) em blocos de legenda: respeita pontuação forte, pausas e limites de tamanho.
    Evita deixar um bloco de 1 palavra sobrando no fim quando dá para equilibrar."""
    blocos, atual = [], []
    for i, p in enumerate(palavras):
        w = p['w'].strip()
        chars = sum(len(x['w'].strip()) for x in atual) + len(atual) + len(w)
        if atual and (len(atual) >= max_palavras or chars > max_chars):
            blocos.append(atual)
            atual = []
        atual.append(p)
        prox = palavras[i + 1] if i + 1 < len(palavras) else None
        fim_frase = bool(re.search(r'[.!?;:…]$', w)) or (prox is not None and prox.get('seg') != p.get('seg'))
        pausa = prox is not None and prox['n0'] - p['n1'] >= pausa_quebra
        if fim_frase or pausa or prox is None:
            blocos.append(atual)
            atual = []
    if atual:
        blocos.append(atual)
    # reequilíbrio: bloco curto no fim da frase se junta ao anterior (se couber) ou puxa a última palavra dele
    out = []
    for b in blocos:
        anterior = out[-1] if out else None
        mesma_frase = anterior is not None and anterior[-1].get('seg') == b[0].get('seg')
        if anterior is not None and mesma_frase and len(b) < min_palavras and len(anterior) + len(b) <= max_palavras:
            out[-1] = anterior + b
        elif anterior is not None and mesma_frase and len(b) == 1 and len(anterior) >= 3:
            out[-1] = anterior[:-1]
            out.append([anterior[-1]] + b)
        else:
            out.append(b)
    return out


def ass_tempo(t):
    t = max(0.0, float(t))
    h = int(t // 3600)
    m = int(t % 3600 // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def escapar_ass(texto):
    return texto.replace('\\', '\\\\').replace('{', '(').replace('}', ')').replace('\n', ' ')


def tamanho_para_bloco(bloco, preset, largura_util=LARGURA - 2 * 60):
    """Reduz a fonte quando a palavra mais longa não cabe numa linha (o libass não quebra palavra)."""
    tam = preset['tamanho']
    maior = max((len(p['w'].strip()) for p in bloco), default=1)
    largura_est = maior * preset['fator_largura'] * tam + 2 * preset['contorno_px']
    if largura_est > largura_util:
        tam = int(largura_util / (maior * preset['fator_largura'] + 0.01))
    return max(40, tam)


def cabecalho_ass(estilo):
    p = PRESETS[estilo]
    negrito = p.get('negrito', 0)
    return (
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {LARGURA}\nPlayResY: {ALTURA}\nWrapStyle: 0\nScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Legenda,{p['fonte']},{p['tamanho']},{p['cor']},{p['cor']},{p['contorno']},{p['fundo']},{negrito},0,0,0,"
        f"100,100,0,0,{p['borda_estilo']},{p['contorno_px']},{p['sombra_px']},2,60,60,{MARGEM_V},1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def eventos_ass(blocos, estilo, sobra=0.35, posicao=None):
    """Um Dialogue por palavra ativa: o bloco inteiro aparece e a palavra da vez muda de cor/escala."""
    p = PRESETS[estilo]
    linhas = []
    for gi, bloco in enumerate(blocos):
        prox_inicio = blocos[gi + 1][0]['n0'] if gi + 1 < len(blocos) else None
        fim_bloco = bloco[-1]['n1'] + sobra
        if prox_inicio is not None:
            fim_bloco = min(fim_bloco, prox_inicio)
        tam = tamanho_para_bloco(bloco, p)
        tags_bloco = f"\\fs{tam}" if tam != p['tamanho'] else ''     # só quando precisou encolher a fonte
        pos = posicao(bloco[0]['n0']) if posicao else ''               # montagem dinâmica: legenda muda de lugar com o layout
        # entrada com "pop": o bloco nasce um pouco menor e cresce em 120 ms
        pop = '\\fscx86\\fscy86\\t(0,120,\\fscx100\\fscy100)'
        prefixo = f"{{{pos}{tags_bloco}}}" if (tags_bloco or pos) else ''
        textos = [escapar_ass(x['w'].strip().upper() if p['maiusculas'] else x['w'].strip()) for x in bloco]
        for i, w in enumerate(bloco):
            ini = w['n0']
            fim = bloco[i + 1]['n0'] if i + 1 < len(bloco) else fim_bloco
            fim = max(fim, ini + 0.08)
            partes = []
            for j, t in enumerate(textos):
                if j == i:
                    esc = p['escala_ativa']
                    partes.append(f"{{\\c{p['cor_ativa']}\\fscx{esc}\\fscy{esc}}}{t}{{\\r{tags_bloco}}}")
                else:
                    partes.append(t)
            entrada = f"{{{pop}}}" if i == 0 else ''
            linhas.append(f"Dialogue: 0,{ass_tempo(ini)},{ass_tempo(fim)},Legenda,,0,0,0,,{prefixo}{entrada}{' '.join(partes)}")
    return linhas


def gerar_ass(palavras_remapeadas, estilo='hormozi', posicao=None):
    """Palavras (n0/n1) → conteúdo completo do arquivo .ass no preset pedido. `posicao(t)` → tags \\an/\\pos por bloco."""
    if estilo not in PRESETS:
        raise ValueError(f"estilo desconhecido: {estilo}")
    p = PRESETS[estilo]
    blocos = agrupar_palavras(palavras_remapeadas, p['max_palavras'], p['max_chars'], p['min_palavras'])
    return cabecalho_ass(estilo) + '\n'.join(eventos_ass(blocos, estilo, posicao=posicao)) + '\n'


# ----------------------------------------------------------------------------------------------------------------------
# B-roll
# ----------------------------------------------------------------------------------------------------------------------
def palavra_chave(texto):
    """Escolhe um substantivo do trecho e traduz para EN pela lista; sem acerto, usa a palavra mais longa."""
    t = (texto or '').lower()
    for chave in sorted(PALAVRAS_CHAVE_EN, key=len, reverse=True):
        if re.search(r'\b' + re.escape(chave) + r'\b', t):
            return PALAVRAS_CHAVE_EN[chave]
    candidatas = [normalizar(w) for w in t.split()]
    candidatas = [w for w in candidatas if len(w) >= 5 and w not in STOPWORDS and not w.isdigit()]
    if candidatas:
        return sem_acentos(max(candidatas, key=len))
    return 'city skyline'


def pontos_broll(frases, duracao_final, cada=18.0, min_inicio=3.0, dur_min=2.5, dur_max=3.5):
    """Um b-roll a cada ~18 s de fala, começando numa frase, nunca nos 3 primeiros segundos.
    Devolve [{inicio, duracao, texto, consulta}] no tempo final."""
    out = []
    if not frases or duracao_final <= min_inicio + dur_min:
        return out
    alvo = cada
    k = 0
    while alvo < duracao_final - dur_min:
        cand = [f for f in frases if f['t0'] >= min_inicio and f['t0'] + dur_min <= duracao_final]
        if not cand:
            break
        f = min(cand, key=lambda f: abs(f['t0'] - alvo))
        if out and f['t0'] - out[-1]['inicio'] < cada * 0.6:
            alvo += cada
            continue
        dur = round(dur_min + (dur_max - dur_min) * ((k * 7) % 5) / 4, 2)   # varia 2,5–3,5 s de forma determinística
        dur = min(dur, duracao_final - f['t0'] - 0.2)
        out.append({'inicio': round(f['t0'], 3), 'duracao': dur, 'texto': f['texto'], 'consulta': palavra_chave(f['texto'])})
        k += 1
        alvo += cada
    return out


def escolher_arquivo_pexels(video, altura_min=1080):
    """Entre os arquivos de um vídeo do Pexels, escolhe o retrato de menor peso com altura ≥ altura_min."""
    arquivos = [f for f in (video or {}).get('video_files', []) if f.get('width') and f.get('height')]
    retratos = [f for f in arquivos if f['height'] > f['width'] and f['height'] >= altura_min and (f.get('file_type') or 'video/mp4') == 'video/mp4']
    if not retratos:
        return None
    return min(retratos, key=lambda f: f['height'])


def resumo_json(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1)


def filtro_rotacao(rotacao):
    """Rotação fica com o próprio ffmpeg (autorotate, padrão): girar na mão dependia do sinal do ffprobe, que mudou
    entre versões — no worker do GitHub o vídeo saiu de lado/de ponta-cabeça. Mantido só por compatibilidade."""
    return ''


def roteiro_incompleto(roteiro, palavras, minimo=0.35):
    """O vídeo cobre o roteiro até o fim? Compara o último terço do roteiro com o que foi falado. None se está completo."""
    rw = [normalizar(w) for w in (roteiro or '').split() if normalizar(w)]
    if len(rw) < 20 or not palavras:
        return None
    falado = [normalizar(p['w']) for p in palavras if normalizar(p['w'])]
    conj = set(falado)
    # só palavras de conteúdo (5+ letras): "de", "o", "seu" aparecem em qualquer fala e escondiam o corte
    terco = [w for w in rw[-max(8, len(rw) // 3):] if len(w) >= 5 and w not in STOPWORDS]
    if len(terco) < 5:
        return None
    cobertura = sum(1 for w in terco if w in conj) / len(terco)
    if cobertura >= minimo:
        return None
    # onde parou: a última sequência de 3 palavras do falado que existe no roteiro
    pos = 0
    for i in range(len(rw) - 2):
        tri = rw[i:i + 3]
        if any(falado[j:j + 3] == tri for j in range(max(0, len(falado) - 12), len(falado) - 2)):
            pos = i + 3
    original = (roteiro or '').split()
    return {'cobertura_final': round(cobertura, 2), 'parou_em': ' '.join(original[max(0, pos - 5):pos]), 'faltou': ' '.join(original[pos:pos + 8])}


# ----------------------------------------------------------------------------------------------------------------------
# Legenda conferida com o roteiro do teleprompter (sem IA)
# ----------------------------------------------------------------------------------------------------------------------
# Frases que o Whisper inventa em áudio cortado ou mudo (vêm das legendas com que ele foi treinado).
ALUCINACOES = re.compile(r'legendas? (pela|por) comunidade|amara\.?org|obrigad[oa] por assistir|inscreva-se no canal|legendado por', re.I)


def _tok(w):
    """Palavra comparável: minúscula, sem acento e sem pontuação ('Anúncio,' → 'anuncio')."""
    return sem_acentos(normalizar(w)).replace('-', '')


def _parecido(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


def _repartir(t0, t1, novas, base):
    """Distribui o tempo [t0, t1] entre as palavras `novas` pelo tamanho de cada uma (a fala dura mais nas longas)."""
    pesos = [len(_tok(w)) + 1 for w in novas]
    total = float(sum(pesos)) or 1.0
    out, acum = [], t0
    for w, peso in zip(novas, pesos):
        fim = acum + (t1 - t0) * peso / total
        out.append(dict(base, t0=round(acum, 3), t1=round(fim, 3), w=w, corrigida=True))
        acum = fim
    return out


def _ancoras(ops):
    """Blocos 'equal' confiáveis: 2+ palavras seguidas, ou 1 palavra sem salto no roteiro. Palavra comum isolada ('em',
    'da') que o difflib casa com um ponto distante do roteiro não conta como âncora."""
    sol, pi, pj = set(), 0, 0
    for k, (op, i1, i2, j1, j2) in enumerate(ops):
        if op != 'equal':
            continue
        if i2 - i1 >= 2 or (j1 - pj) <= (i1 - pi) + 2:
            sol.add(k); pi, pj = i2, j2
    return sol


def alinhar_com_roteiro(palavras, roteiro, parecido_min=0.55, parecido_entre=0.45, max_bloco=4, max_sobra=6):
    """Confere cada palavra do Whisper com o roteiro que o Pedro leu no teleprompter e devolve (palavras, relatório).
    - Palavra igual (sem acento/pontuação): fica com a grafia do roteiro (acento, maiúscula e pontuação certos — a
      pontuação também separa as frases do vídeo).
    - Trecho curto trocado pelo Whisper e parecido com o roteiro ('anos caros' no lugar de 'anúncio caro'): vira o
      texto do roteiro, no mesmo tempo da fala. Entre duas palavras certas, aceita parecença um pouco menor.
    - Palavra dita fora do roteiro (improviso, 'e' a mais): fica como o Whisper ouviu.
    - Depois da última palavra que bate com o roteiro, se o roteiro não terminou: até `max_sobra` palavras saem (é o
      Whisper completando uma gravação cortada, como o 'prática…' que ninguém falou); sobra maior é improviso e fica.
      Frases-fantasma conhecidas ('Legendas pela comunidade Amara.org') saem sempre."""
    rot = [w for w in (roteiro or '').split() if _tok(w)]
    pal = [p for p in (palavras or []) if _tok(p.get('w'))]
    rel = {'corrigidas': [], 'removidas': [], 'iguais': 0}
    if len(rot) < 5 or not pal:
        return list(palavras or []), rel
    tn, rn = [_tok(p['w']) for p in pal], [_tok(w) for w in rot]
    ops = difflib.SequenceMatcher(None, tn, rn, autojunk=False).get_opcodes()
    sol = _ancoras(ops)
    out = []          # (palavra, origem) — origem: 'igual' (âncora) | 'corrigida' | 'fala'
    j_ult = 0
    for k, (op, i1, i2, j1, j2) in enumerate(ops):
        if op == 'equal':
            origem = 'igual' if k in sol else 'fala'
            for d in range(i2 - i1):
                out.append((dict(pal[i1 + d], w=rot[j1 + d]) if k in sol else dict(pal[i1 + d]), origem))
            if k in sol:
                rel['iguais'] += i2 - i1; j_ult = max(j_ult, j2)
        elif op == 'replace':
            nt, nr = i2 - i1, j2 - j1
            entre = (k - 1) in sol and (k + 1) in sol
            limite = parecido_entre if (entre and nt == nr) else parecido_min
            sim = _parecido(' '.join(tn[i1:i2]), ' '.join(rn[j1:j2]))
            if nt <= max_bloco and nr <= max_bloco + 1 and abs(nt - nr) <= 1 and sim >= limite:
                base = {x: v for x, v in pal[i1].items() if x not in ('t0', 't1', 'w')}
                base['p'] = min(p.get('p', 1.0) for p in pal[i1:i2])
                novas = _repartir(pal[i1]['t0'], pal[i2 - 1]['t1'], rot[j1:j2], base)
                out += [(n, 'corrigida') for n in novas]
                rel['corrigidas'].append({'de': ' '.join(p['w'] for p in pal[i1:i2]), 'para': ' '.join(rot[j1:j2]), 't0': pal[i1]['t0']})
                j_ult = max(j_ult, j2) if entre else j_ult
            else:
                out += [(dict(p), 'fala') for p in pal[i1:i2]]
        elif op == 'delete':
            out += [(dict(p), 'fala') for p in pal[i1:i2]]
        # 'insert': palavra do roteiro que não foi dita → nada a fazer
    ult = max((i for i, (_, o) in enumerate(out) if o == 'igual'), default=-1)
    roteiro_terminou = j_ult >= len(rot) - 3
    sobra = len(out) - 1 - ult
    cortar_sobra = ult >= 0 and not roteiro_terminou and 0 < sobra <= max_sobra
    final = []
    for i, (p, origem) in enumerate(out):
        fantasma = ALUCINACOES.search(p['w']) is not None
        if fantasma or (cortar_sobra and i > ult):
            rel['removidas'].append({'w': p['w'], 't0': p['t0'], 'motivo': 'frase-fantasma do Whisper' if fantasma else 'depois do fim da fala (gravação cortada)'})
            continue
        final.append(p)
    # frase-fantasma em várias palavras ("Legendas pela comunidade Amara.org"): confere o texto corrido também
    texto = ' '.join(p['w'] for p in final)
    m = ALUCINACOES.search(texto)
    if m and not ALUCINACOES.search(roteiro or ''):
        ini = len(texto[:m.start()].split())
        n = len(m.group(0).split())
        for p in final[ini:ini + n]:
            rel['removidas'].append({'w': p['w'], 't0': p['t0'], 'motivo': 'frase-fantasma do Whisper'})
        final = final[:ini] + final[ini + n:]
    return final, rel
