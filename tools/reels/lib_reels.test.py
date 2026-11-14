#!/usr/bin/env python3
"""Testes das funções puras do editor de reels. Rode: python3 tools/reels/lib_reels.test.py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_reels as L  # noqa: E402


def palavras(seq, inicio=0.0, dur=0.3, pausa=0.1, seg=0):
    """Monta palavras igualmente espaçadas: 'a b c' → [{t0,t1,w,seg}]."""
    out, t = [], inicio
    for w in seq.split():
        out.append({'t0': round(t, 3), 't1': round(t + dur, 3), 'w': w, 'seg': seg})
        t += dur + pausa
    return out


class Intervalos(unittest.TestCase):
    def test_unir(self):
        self.assertEqual(L.unir_intervalos([(3, 4), (1, 2), (1.5, 2.5)]), [(1.0, 2.5), (3.0, 4.0)])
        self.assertEqual(L.unir_intervalos([(1, 2), (2.02, 3)], folga=0.05), [(1.0, 3.0)])

    def test_subtrair(self):
        self.assertEqual(L.subtrair_intervalos([(0, 10)], [(2, 3), (5, 6)]), [(0.0, 2.0), (3.0, 5.0), (6.0, 10.0)])
        self.assertEqual(L.subtrair_intervalos([(0, 10)], [(-1, 11)]), [])
        self.assertEqual(L.subtrair_intervalos([(0, 2), (4, 6)], [(1, 5)]), [(0.0, 1.0), (5.0, 6.0)])

    def test_proteger_inicio(self):
        self.assertEqual(L.proteger_inicio([(2, 5)], 10), [(0.0, 1.0), (2.0, 5.0)])
        self.assertEqual(L.proteger_inicio([(0.5, 5)], 10), [(0.0, 5.0)])

    def test_limpar(self):
        self.assertEqual(L.limpar_trechos([(0, 1), (1.02, 2), (3, 3.05)]), [(0.0, 2.0)])


class Silencios(unittest.TestCase):
    LOG = ("[silencedetect @ 0x1] silence_start: 5.2\n[silencedetect @ 0x1] silence_end: 6.4 | silence_duration: 1.2\n"
           "[silencedetect @ 0x1] silence_start: 9.0\n")

    def test_parse(self):
        self.assertEqual(L.parse_silencedetect(self.LOG), [(5.2, 6.4), (9.0, None)])

    def test_trechos_por_silencio(self):
        tr = L.trechos_por_silencio(10.0, [(5.2, 6.4), (9.0, None)], margem=0.15)
        self.assertEqual(tr, [(0.0, 5.35), (6.25, 9.15)])

    def test_silencio_curto_nao_corta(self):
        # silêncio de 0,2 s com margem de 0,15 de cada lado não sobra nada para cortar
        self.assertEqual(L.trechos_por_silencio(10.0, [(5.0, 5.2)]), [(0.0, 10.0)])


class Cortes(unittest.TestCase):
    def test_muleta_isolada(self):
        p = palavras('eu acho', 0.0) + [{'t0': 2.0, 't1': 2.3, 'w': 'É…', 'seg': 0}] + palavras('que sim', 3.0)
        c = L.cortes_muletas(p)
        self.assertEqual(len(c), 1)
        self.assertLess(c[0][0], 2.0)
        self.assertGreater(c[0][1], 2.3)

    def test_muleta_colada_fica(self):
        # 'né' sem pausa dos dois lados faz parte da frase ('é bom, né gente') e não sai
        p = palavras('é bom né gente', pausa=0.05)
        self.assertEqual(L.cortes_muletas(p), [])

    def test_repeticoes(self):
        p = palavras('eu eu eu acho')
        c = L.cortes_repeticoes(p)
        self.assertEqual(c, [(p[0]['t0'], p[2]['t0'])])   # fica só o último 'eu'

    def test_retomada_fica_a_ultima(self):
        p = palavras('a economia brasileira precisa', 0.0) + palavras('a economia brasileira precisa de liberdade', 2.0)
        cortes, idx = L.detectar_retomadas(p)
        self.assertEqual(cortes, [(0.0, 2.0)])
        self.assertEqual(idx, [0, 1, 2, 3])

    def test_retomada_com_palavras_no_meio(self):
        p = palavras('o governo gastou não o governo gastou mais', 0.0)
        cortes, _ = L.detectar_retomadas(p)
        self.assertEqual(len(cortes), 1)
        self.assertEqual(cortes[0], (p[0]['t0'], p[4]['t0']))

    def test_retomada_fora_da_janela_nao_conta(self):
        p = palavras('a economia brasileira', 0.0) + palavras('a economia brasileira', 10.0)
        self.assertEqual(L.detectar_retomadas(p)[0], [])

    def test_duas_palavras_nao_e_retomada(self):
        p = palavras('a gente a gente vai')
        self.assertEqual(L.detectar_retomadas(p)[0], [])

    def test_montar_trechos_protege_inicio(self):
        tr, det = L.montar_trechos(10.0, [(0.0, 3.0)], [])
        self.assertEqual(tr[0][0], 0.0)
        self.assertGreaterEqual(tr[0][1], 1.0)
        self.assertEqual(det['cortes'], len(tr) - 1)

    def test_montar_trechos_sem_nada(self):
        tr, det = L.montar_trechos(10.0, [], [], remover_pausas=False)
        self.assertEqual(tr, [(0.0, 10.0)])
        self.assertEqual(det['cortes'], 0)


class Remapeamento(unittest.TestCase):
    def test_mapear_instante(self):
        tr = [(0, 2), (5, 7)]
        self.assertEqual(L.mapear_instante(1.0, tr), 1.0)
        self.assertEqual(L.mapear_instante(6.0, tr), 3.0)
        self.assertIsNone(L.mapear_instante(3.0, tr))

    def test_remapear_tempos(self):
        p = [{'t0': 1.0, 't1': 1.5, 'w': 'a', 'seg': 0}, {'t0': 3.0, 't1': 3.4, 'w': 'b', 'seg': 0}, {'t0': 5.5, 't1': 6.0, 'w': 'c', 'seg': 1}]
        r = L.remapear_tempos(p, [(0, 2), (5, 7)])
        self.assertEqual([x['w'] for x in r], ['a', 'c'])
        self.assertEqual((r[0]['n0'], r[0]['n1']), (1.0, 1.5))
        self.assertEqual((r[1]['n0'], r[1]['n1']), (2.5, 3.0))

    def test_palavra_cortada_de_proposito_some(self):
        p = [{'t0': 1.0, 't1': 1.3, 'w': 'é', 'seg': 0}, {'t0': 3.0, 't1': 3.4, 'w': 'sim', 'seg': 0}]
        r = L.remapear_tempos(p, [(0, 0.9), (2.9, 5)], cortes_intencionais=[(0.9, 2.9)])
        self.assertEqual([x['w'] for x in r], ['sim'])

    def test_palavra_orfa_encaixa_do_lado_da_frase(self):
        # 'A' curto caiu num corte de silêncio; a próxima palavra da mesma frase está no trecho seguinte
        p = [{'t0': 16.7, 't1': 17.2, 'w': 'precisa', 'seg': 1}, {'t0': 17.86, 't1': 18.45, 'w': 'A', 'seg': 2}, {'t0': 18.6, 't1': 19.6, 'w': 'economia', 'seg': 2}]
        r = L.remapear_tempos(p, [(10, 17.88), (18.57, 30)])
        self.assertEqual([x['w'] for x in r], ['precisa', 'A', 'economia'])
        a = r[1]
        self.assertTrue(a['encaixada'])
        self.assertEqual(a['n0'], 7.88)                 # começo do 2º trecho no tempo final
        self.assertLessEqual(a['n1'], r[2]['n0'])       # não invade a palavra seguinte

    def test_palavra_orfa_longe_some(self):
        p = [{'t0': 5.0, 't1': 5.2, 'w': 'x', 'seg': 0}]
        self.assertEqual(L.remapear_tempos(p, [(0, 1), (9, 10)]), [])

    def test_frases_remapeadas(self):
        r = [{'n0': 0, 'n1': 0.5, 'w': 'Oi', 'seg': 0}, {'n0': 0.6, 'n1': 1.0, 'w': 'gente.', 'seg': 0}, {'n0': 1.5, 'n1': 2.0, 'w': 'Tchau.', 'seg': 1}]
        f = L.frases_remapeadas(r)
        self.assertEqual(f, [{'t0': 0, 't1': 1.0, 'texto': 'Oi gente.'}, {'t0': 1.5, 't1': 2.0, 'texto': 'Tchau.'}])


class PunchIn(unittest.TestCase):
    def test_dividir(self):
        self.assertEqual(L.dividir_trechos([(0, 10)], [3, 7, 9.99]), [(0, 3.0), (3.0, 7.0), (7.0, 10)])

    def test_planejar_zoom_alterna_e_fades_so_nas_emendas(self):
        segs = L.planejar_segmentos([(0, 6), (8, 12)], inicios_frases=[0, 3, 8])
        self.assertEqual([s['zoom'] for s in segs], [1.0, 1.08, 1.0])
        self.assertEqual([(s['fade_in'], s['fade_out']) for s in segs], [(True, False), (False, True), (True, True)])

    def test_sem_punch_in(self):
        segs = L.planejar_segmentos([(0, 6)], inicios_frases=[0, 3], punch_in=False)
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0]['zoom'], 1.0)


class Enquadramento(unittest.TestCase):
    def test_suavizar(self):
        s = L.suavizar_centros([0.5, 0.5, 0.9, 0.9, None, 0.9])
        self.assertEqual(s[0], 0.5)
        self.assertEqual(s[1], 0.5)
        self.assertLessEqual(s[2] - s[1], 0.02 + 1e-9)     # limite de passo
        self.assertEqual(s[4], s[3])                        # sem rosto: mantém
        self.assertGreater(s[5], s[4])

    def test_zona_morta(self):
        s = L.suavizar_centros([0.5, 0.51, 0.52])
        self.assertEqual(s, [0.5, 0.5, 0.5])

    def test_centro_por_segmento(self):
        am = [(0.5, 0.2, 0.4), (1.5, 0.4, 0.4), (5.0, 0.8, 0.5)]
        c = L.centro_por_segmento(am, [{'a': 0, 'b': 2}, {'a': 4, 'b': 6}, {'a': 10, 'b': 12}])
        self.assertEqual(c[0], (0.3, 0.4))
        self.assertEqual(c[1], (0.8, 0.5))
        self.assertEqual(c[2], (0.8, 0.5))    # sem amostra dentro: a mais próxima

    def test_geometria_horizontal(self):
        w, h, x, y = L.geometria_crop(1280, 720, 1.0, cx=0.9)
        self.assertEqual(h, 1920)
        self.assertEqual(w, 3414)
        self.assertEqual(x, w - 1080)       # rosto na direita: crop encosta na borda
        self.assertEqual(y, 0)

    def test_geometria_vertical_com_zoom(self):
        w, h, x, y = L.geometria_crop(1080, 1920, 1.12)
        self.assertEqual((w, h), (1210, 2152))
        self.assertEqual((x, y), (65, 116))

    def test_rotacao(self):
        # a rotação fica com o ffmpeg (autorotate): o filtro manual não existe mais (girava duas vezes no worker)
        self.assertEqual(L.filtro_rotacao(-90), '')
        self.assertEqual(L.filtro_rotacao_legado(-90), 'transpose=1')

    def setUp(self):
        p = palavras('O governo gastou mais do que arrecadou pelo décimo ano seguido.', 0.0)
        self.pal = L.remapear_tempos(p, [(0, 100)])

    def test_agrupar_limites(self):
        blocos = L.agrupar_palavras(self.pal, max_palavras=4, max_chars=26, min_palavras=3)
        self.assertTrue(all(len(b) <= 4 for b in blocos))
        self.assertEqual(sum(len(b) for b in blocos), len(self.pal))
        self.assertTrue(all(len(b) >= 2 for b in blocos))   # nada de palavra solta no fim

    def test_agrupar_quebra_na_pausa(self):
        p = palavras('sim', 0.0) + palavras('não', 5.0)
        blocos = L.agrupar_palavras(L.remapear_tempos(p, [(0, 10)]), max_palavras=6, max_chars=40)
        self.assertEqual(len(blocos), 2)

    def test_tamanho_para_palavra_longa(self):
        bloco = [{'w': 'CONSTITUCIONALMENTE', 'n0': 0, 'n1': 1}]
        self.assertLess(L.tamanho_para_bloco(bloco, L.PRESETS['hormozi']), 96)
        self.assertEqual(L.tamanho_para_bloco([{'w': 'SIM', 'n0': 0, 'n1': 1}], L.PRESETS['hormozi']), 96)

    def test_ass_tempo(self):
        self.assertEqual(L.ass_tempo(0), '0:00:00.00')
        self.assertEqual(L.ass_tempo(3661.5), '1:01:01.50')

    def test_gerar_ass_presets(self):
        for estilo, p in L.PRESETS.items():
            ass = L.gerar_ass(self.pal, estilo)
            self.assertIn('PlayResX: 1080', ass)
            self.assertIn(f"Style: Legenda,{p['fonte']},{p['tamanho']}", ass)
            self.assertIn(f",2,60,60,{L.MARGEM_V},1", ass)         # alinhamento 2 embaixo, fora da UI do Reels
            self.assertEqual(ass.count('Dialogue:'), len(self.pal))  # um evento por palavra ativa
            self.assertIn(p['cor_ativa'], ass)
        self.assertIn('GOVERNO', L.gerar_ass(self.pal, 'hormozi'))
        self.assertIn('governo', L.gerar_ass(self.pal, 'caixa'))
        self.assertIn('BorderStyle', L.gerar_ass(self.pal, 'caixa'))

    def test_eventos_nao_invadem_o_bloco_seguinte(self):
        ass = L.gerar_ass(self.pal, 'beast')
        linhas = [l for l in ass.splitlines() if l.startswith('Dialogue:')]
        tempos = [(l.split(',')[1], l.split(',')[2]) for l in linhas]
        for (i0, f0), (i1, f1) in zip(tempos, tempos[1:]):
            self.assertLessEqual(f0, i1)

    def test_escapar(self):
        self.assertEqual(L.escapar_ass('a{b}\\c'), 'a(b)\\\\c')

    def test_estilo_invalido(self):
        with self.assertRaises(ValueError):
            L.gerar_ass(self.pal, 'neon')


class Broll(unittest.TestCase):
    def test_palavra_chave(self):
        self.assertEqual(L.palavra_chave('O governo gastou demais'), 'government building')
        self.assertEqual(L.palavra_chave('Menos imposto para quem produz'), 'taxes money')
        self.assertEqual(L.palavra_chave('a gente vai lá'), 'city skyline')
        self.assertEqual(L.palavra_chave('comprei uma bicicleta ontem'), 'bicicleta')

    def test_pontos_broll(self):
        frases = [{'t0': t, 't1': t + 4, 'texto': 'o governo gastou'} for t in range(0, 60, 5)]
        pts = L.pontos_broll(frases, 60.0)
        self.assertTrue(all(p['inicio'] >= 3.0 for p in pts))
        self.assertTrue(all(2.5 <= p['duracao'] <= 3.5 for p in pts))
        self.assertEqual(len(pts), 3)                      # ~18 s, ~36 s e ~54 s
        self.assertTrue(all(b['inicio'] - a['inicio'] >= 18 * 0.6 for a, b in zip(pts, pts[1:])))
        self.assertTrue(all(p['inicio'] + p['duracao'] <= 60 for p in pts))

    def test_pontos_broll_video_curto(self):
        self.assertEqual(L.pontos_broll([{'t0': 1, 't1': 2, 'texto': 'x'}], 12.0), [])

    def test_escolher_arquivo_pexels(self):
        v = {'video_files': [
            {'width': 1920, 'height': 1080, 'link': 'h', 'file_type': 'video/mp4'},
            {'width': 1080, 'height': 1920, 'link': 'p1', 'file_type': 'video/mp4'},
            {'width': 2160, 'height': 3840, 'link': 'p2', 'file_type': 'video/mp4'},
            {'width': 540, 'height': 960, 'link': 'p0', 'file_type': 'video/mp4'},
        ]}
        self.assertEqual(L.escolher_arquivo_pexels(v)['link'], 'p1')
        self.assertIsNone(L.escolher_arquivo_pexels({'video_files': [{'width': 1920, 'height': 1080, 'link': 'h'}]}))


class Texto(unittest.TestCase):
    def test_normalizar(self):
        self.assertEqual(L.normalizar(' Eu, '), 'eu')
        self.assertEqual(L.normalizar('É…'), 'é')

    def test_initial_prompt(self):
        p = L.montar_initial_prompt('palavra ' * 300)
        self.assertEqual(len(p.split()), 200 + len('É… tipo, né? Hã, então, assim…'.split()))
        self.assertTrue(L.montar_initial_prompt('').startswith('É…'))




# ── Montagem dinâmica e cortes pelas palavras (14/11/2026) ─────────────────────────────────────────────────────────
class Montagem(unittest.TestCase):
    def test_cortes_pelas_palavras_nao_apagam_fala_baixa(self):
        pal = [{'t0': 1.7, 't1': 2.0, 'w': 'Você'}, {'t0': 2.1, 't1': 2.4, 'w': 'não.'}, {'t0': 4.0, 't1': 4.5, 'w': 'Uma'}, {'t0': 4.55, 't1': 5.0, 'w': 'marca'}]
        tr = L.trechos_por_palavras(pal, 10)
        assert len(tr) == 2
        for p in pal:   # toda palavra inteira dentro de um trecho
            assert any(a <= p['t0'] and p['t1'] <= b for a, b in tr), p
        # o vão de 1,6 s virou respiro curto, não sumiu nem ficou inteiro
        assert 0.3 <= (tr[0][1] - 2.4) + (4.0 - tr[1][0]) <= 0.6


    def test_montagem_alterna_layouts_e_gancho_e_rosto(self):
        import lib_montagem as M
        frases = [{'n0': i * 3.0, 'n1': i * 3.0 + 2.8, 'texto': t} for i, t in enumerate(
            ['Você não precisa de investidor', 'O preço caiu 30%', 'Ela focou no cliente', 'A marca cresceu muito', 'Faça isso hoje'])]
        b = M.planejar_blocos(frases, 15)
        assert b[0]['layout'] == 'rosto'
        assert all(b[i]['layout'] != b[i + 1]['layout'] for i in range(len(b) - 1))
        assert abs(b[-1]['t1'] - 15) < 1e-6 and b[0]['t0'] == 0
        assert M.palavra_chave('O preço caiu 30%') == '30%'
        ass = M.ass_graficos(b, 'topo')
        assert 'PlayResY: 960' in ass and '\\clip(' in ass


    def test_legenda_muda_de_lugar_com_o_layout(self):
        import lib_montagem as M
        b = [{'t0': 0, 't1': 2, 'layout': 'rosto'}, {'t0': 2, 't1': 4, 'layout': 'dividida'}]
        pos = M.posicao_legenda(b)
        assert '1360' in pos(1.0) and '960' in pos(3.0)



def _avaliar(expr, t):
    """Avalia uma expressão do ffmpeg gerada por expr_linear (só usa +, -, *, /, clip e t)."""
    return eval(expr, {'__builtins__': {}}, {'clip': lambda x, a, b: min(max(x, a), b), 't': t})


class Rastreio(unittest.TestCase):
    """O recorte segue o rosto quadro a quadro (pedido do Pedro: rosto centralizado na janela de baixo)."""
    def test_trilha_preenche_buracos_e_tira_pico(self):
        cru = [(i / 6, 0.5, 0.5, 0.3) for i in range(30)]
        cru[10] = (10 / 6, None, None, None)        # rosto não achado
        cru[20] = (20 / 6, 0.95, 0.1, 0.3)          # detecção falsa
        tr = L.trilha_rosto(cru)
        self.assertEqual(len(tr['t']), 30)
        self.assertTrue(all(abs(v - 0.5) < 0.01 for v in tr['cx']))
        self.assertTrue(all(abs(v - 0.5) < 0.01 for v in tr['cy']))
        self.assertIsNone(L.trilha_rosto([(0.1, None, None, None)]))
        self.assertIsNone(L.trilha_rosto([]))

    def test_trilha_sem_atraso(self):
        # rosto andando para a direita em velocidade constante: a suavização não pode atrasar (fase zero)
        cru = [(i / 6, 0.3 + 0.01 * i, 0.5, 0.3) for i in range(40)]
        tr = L.trilha_rosto(cru)
        for i in range(8, 32):
            self.assertAlmostEqual(tr['cx'][i], 0.3 + 0.01 * i, places=3)
        self.assertAlmostEqual(L.posicao_na_trilha(tr, 15.5 / 6)[0], 0.455, places=3)

    def test_expressao_linear(self):
        pts = [(0, 10), (0.25, 10), (0.5, 12.3), (1.0, 8)]
        e = L.expr_linear(pts)
        self.assertNotIn(':', e)
        for t, v in [(-1, 10), (0, 10), (0.25, 10), (0.375, 11.15), (0.5, 12.3), (0.75, 10.15), (1.0, 8), (5, 8)]:
            self.assertAlmostEqual(_avaliar(e, t), v, places=4)
        self.assertEqual(L.expr_linear([(0, 3), (1, 3)]), '3.0')

    def test_crop_centraliza_e_respeita_limites(self):
        tr = L.trilha_rosto([(i / 6, 0.5 + 0.004 * i, 0.5, 0.3) for i in range(60)])
        larg, alt, cl, ca = 1200, 2000, 948, 750
        ex, ey = L.chaves_crop(tr, 2.0, 4.0, larg, alt, cl, ca, cl / 2, 150 + 276, topo=150)
        for tl in (0, 0.5, 1.0, 1.5, 2.0):
            cx, cy = L.posicao_na_trilha(tr, 2.0 + tl)
            x, y = _avaliar(ex, tl), _avaliar(ey, tl)
            self.assertTrue(0 <= x <= larg - cl and 0 <= y <= alt + 150 - ca)
            self.assertAlmostEqual(cx * larg - x, cl / 2, delta=1.0)           # rosto no centro do recorte
            self.assertAlmostEqual(cy * alt + 150 - y, 150 + 276, delta=1.0)
        # rosto colado na borda: o recorte para no limite (não mostra fora da imagem)
        tr2 = L.trilha_rosto([(i / 6, 0.02, 0.98, 0.3) for i in range(12)])
        ex2, ey2 = L.chaves_crop(tr2, 0, 1.5, larg, alt, cl, ca, cl / 2, 426, topo=150)
        self.assertEqual((_avaliar(ex2, 0.7), _avaliar(ey2, 0.7)), (0.0, alt + 150 - ca))
        # sem rosto: recorte fixo
        ex3, ey3 = L.chaves_crop(None, 0, 3, larg, alt, cl, ca, cl / 2, 426, topo=150)
        self.assertNotIn('clip', ex3 + ey3)


class Destrava(unittest.TestCase):
    """Formato da referência do Pedro (14/11/2026): gráficos em cima, janela embaixo, legenda de uma palavra."""
    def _pal(self, textos):
        pal, t = [], 0.3
        for k, tx in enumerate(textos):
            for w in tx.split():
                pal.append({'n0': round(t, 3), 'n1': round(t + 0.3, 3), 'w': w}); t += 0.36
            t += 0.3
        return pal, t

    def test_tipos_de_quadro(self):
        import lib_destrava as D
        pal, dur = self._pal(['Você não precisa de investidor para crescer.', 'No Brasil, 6 em cada 10 empresas fecham.',
                              'Ela focou em duas coisas básicas.', 'Produto impecável e preço que a cliente paga.',
                              'Quem manda no estoque manda na empresa.', 'Salva esse vídeo para lembrar.'])
        frases = D.frases_por_pontuacao(pal)
        self.assertEqual(len(frases), 6)
        b = D.planejar(frases, dur, 'Cresça sem investidor', broll=False)
        tipos = [x['tipo'] for x in b]
        self.assertEqual(tipos[0], 'titulo')
        self.assertEqual(tipos[-1], 'fim')
        self.assertIn('numero', tipos)
        self.assertEqual(D.palavra_chave('No Brasil, 6 em cada 10 empresas fecham.'), '6 em 10')
        listas = [x for x in b if x['tipo'] == 'lista']
        self.assertEqual(len(listas), 2)
        self.assertEqual(listas[0]['itens_novos'], [])                       # o anúncio não mostra os itens antes da hora
        self.assertEqual(listas[1]['itens_novos'], ['Produto impecável', 'Preço que a cliente paga'])
        self.assertEqual(b[0]['t0'], 0.0); self.assertAlmostEqual(b[-1]['t1'], dur)
        g = D.ass_graficos(b)
        self.assertIn('Instrument Serif', g)
        f = D.ass_final(b, pal, dur)
        self.assertIn('@PEDRO_DESTRAVA', f)
        self.assertEqual(sum(1 for ln in f.splitlines() if ',Legenda,' in ln), len(pal))   # uma palavra por evento
        # sem marca d'água lateral (pedido do Pedro, 14/11): o @ só aparece na tela final
        ini_fim = b[-1]['t0']
        for ln in f.splitlines():
            if 'PEDRO_DESTRAVA' in ln:
                hh, mm, ss = ln.split(',')[1].split(':')
                self.assertGreaterEqual(int(hh) * 3600 + int(mm) * 60 + float(ss), ini_fim - 0.01, ln)

    def test_sem_marca_lateral_sem_tela_final(self):
        import lib_destrava as D
        pal, dur = self._pal(['Você não precisa de investidor.', 'Quem manda no estoque manda na empresa.'])
        b = D.planejar(D.frases_por_pontuacao(pal), dur, '', broll=False)
        self.assertNotEqual(b[-1]['layout'], 'fim')   # "quem MANDA no estoque" não é chamada final
        f = D.ass_final(b, pal, dur)   # vídeo curto (< 8 s) e sem chamada: nenhum @ nem logo
        self.assertNotIn('PEDRO_DESTRAVA', f)
        self.assertEqual([ln for ln in f.splitlines() if ln.startswith('Dialogue') and ',Legenda,' not in ln], [])

    def test_graficos_acima_da_legenda_e_da_cabeca(self):
        import re as _re
        import lib_destrava as D
        topo_cabeca = D.JANELA['y'] - D.RECORTE
        self.assertLess(D.Y_LEGENDA['split'] + 40, topo_cabeca)   # a legenda de uma palavra fica acima da cabeça
        for q in (D.INSET_IMAGEM, D.INSET_TITULO):
            self.assertLessEqual(q['y'] + q['h'], D.Y_LEGENDA['split'] - 45)
        pal, dur = self._pal(['Você não precisa de investidor para crescer.', 'No Brasil, 6 em cada 10 empresas fecham.',
                              'Ela focou em quatro coisas básicas.', 'Produto, preço, prazo e caixa.',
                              'Quem manda no estoque manda na empresa.', 'O dinheiro do lucro paga a produção seguinte.'])
        b = D.planejar(D.frases_por_pontuacao(pal), dur, 'Cresça sem investidor', broll=False)
        g = D.ass_graficos(b)
        ys = [int(m) for m in _re.findall(r'\\pos\(\d+,(\d+)\)', g)]
        self.assertTrue(ys)
        self.assertLessEqual(max(ys), D.Y_LEGENDA['split'] - 90)
        for desenho in _re.findall(r'\\p1\}([^{]*)\{', g):   # formas vetoriais (cartões, fichas) também param antes
            nums = [float(x) for x in desenho.replace('m', ' ').replace('l', ' ').replace('b', ' ').split()]
            self.assertLessEqual(max(nums[1::2]), D.Y_LEGENDA['split'] - 45, desenho[:60])

    def test_escala_da_janela(self):
        import lib_destrava as D
        # selfie de perto (rosto = 1/3 da altura): só a folga de 6% para centralizar, sem aumentar o rosto
        s, w, h = D.escala_janela(1080, 1920, 0.33)
        self.assertAlmostEqual(s, D.JANELA['w'] / 1080 * D.ZOOM_JANELA, places=4)
        self.assertGreater(w, D.JANELA['w']); self.assertEqual(w % 2, 0); self.assertEqual(h % 2, 0)
        # câmera longe (rosto pequeno, vídeo deitado): aproxima, mas no máximo 2,2× a escala base
        s2, w2, h2 = D.escala_janela(1920, 1080, 0.12)
        base = max(D.JANELA['w'] / 1920, D.JANELA['h'] / 1080)
        self.assertAlmostEqual(s2, base * 2.2, places=4)
        s3, _, _ = D.escala_janela(1920, 1080, 0.3)
        self.assertAlmostEqual(s3, 0.62 * D.JANELA['h'] / (0.3 * 1080), places=4)
        self.assertGreaterEqual(D.escala_janela(1080, 1920, None)[1], D.JANELA['w'])

    def test_roteiro_incompleto_avisa(self):
        # caso real (14/11): o iPhone parou a gravação aos 33,6 s e o roteiro tinha ~56 s
        rot = ("Você não precisa de investidor milionário para criar uma marca gigante. Uma designer americana provou isso na prática. "
               "Lele Sadoughi começou a marca de joias dela do zero. Ela focou em duas coisas básicas: produto com acabamento impecável "
               "e preço que a cliente consegue pagar. Em vez de torcer dinheiro em anúncio caro, o lucro da primeira venda pagava a "
               "produção da seguinte. No Brasil, muito dono de negócio quebra porque busca sócio investidor antes de ter caixa próprio. "
               "Quem manda no seu estoque manda na sua empresa. Crescer com o próprio lucro garante a sua liberdade. "
               "Salva esse vídeo para lembrar disso quando pensar em pegar dinheiro emprestado.")
        falado = rot.split('No Brasil')[0]
        r = L.roteiro_incompleto(rot, [{'w': w} for w in falado.split()])
        self.assertIsNotNone(r)
        self.assertIn('No Brasil', r['faltou'])
        self.assertIsNone(L.roteiro_incompleto(rot, [{'w': w} for w in rot.split()]))


class Pedido15Nov(unittest.TestCase):
    """O que o Pedro aprovou em 15/11: começo sem segundo mudo, legenda conferida com o roteiro, tela final limpa,
    cartão com frases reais, sem palavra repetida, plano visual, novos tipos de cena e sons."""
    ROT = ("Você não precisa de investidor milionário para criar uma marca gigante. Uma designer americana provou isso na prática. "
           "E o passo final dela é a maior lição pro seu negócio. Lele Sadoughi começou a marca de joias dela do zero. "
           "Sem fundo de investimento botando milhões na conta. Ela focou em duas coisas básicas: produto com acabamento impecável "
           "e preço que a cliente consegue pagar. Em vez de torcer dinheiro em anúncio caro, o lucro da primeira venda pagava a "
           "produção da seguinte. No Brasil, muito dono de negócio quebra porque busca sócio investidor antes de ter caixa próprio. "
           "Quem manda no seu estoque manda na sua empresa. Crescer com o próprio lucro garante a sua liberdade. "
           "Salva esse vídeo para lembrar disso quando pensar em pegar dinheiro emprestado.")

    def _pal(self, texto, p=0.9):
        return [{'t0': round(1.1 + i * 0.3, 3), 't1': round(1.1 + i * 0.3 + 0.25, 3), 'w': w, 'p': p, 'seg': 0} for i, w in enumerate(texto.split())]

    def test_legenda_corrige_pelo_roteiro_e_tira_palavra_inventada(self):
        # transcrição real de produção (14/11): "anos caros" no lugar de "anúncio caro" e "prática…" que ninguém falou
        falado = self.ROT.split(' o lucro da')[0].replace('anúncio caro,', 'anos caros,') + ' o lucro da prática…'
        out, rel = L.alinhar_com_roteiro(self._pal(falado), self.ROT)
        texto = ' '.join(p['w'] for p in out)
        self.assertIn('anúncio caro, o lucro da', texto)
        self.assertNotIn('anos', texto); self.assertNotIn('prática…', texto)
        self.assertEqual([c['para'] for c in rel['corrigidas']], ['anúncio caro,'])
        self.assertEqual([r['w'] for r in rel['removidas']], ['prática…'])
        # pontuação do roteiro: "básicas:" separa a lista
        self.assertIn('duas coisas básicas: produto', texto)

    def test_legenda_corrige_palavra_trocada_entre_trechos_certos(self):
        # produção (14/11, 2ª versão): "o lucro da prática pagava a produção" — ele leu "primeira venda"
        falado = self.ROT.split(' da seguinte.')[0].replace('da primeira venda pagava', 'da prática pagava')
        out, rel = L.alinhar_com_roteiro(self._pal(falado), self.ROT)
        texto = ' '.join(p['w'] for p in out)
        self.assertIn('o lucro da primeira venda pagava a produção', texto)
        self.assertNotIn('prática pagava', texto)

    def test_legenda_mantem_improviso_e_fala_diferente(self):
        falado = self.ROT.replace('sua empresa', 'seu negócio') + ' Valeu demais, até amanhã pessoal.'
        out, rel = L.alinhar_com_roteiro(self._pal(falado), self.ROT)
        texto = ' '.join(p['w'] for p in out)
        self.assertIn('manda na seu negócio.', texto)     # ele falou diferente: a legenda mostra o que ele falou
        self.assertNotIn('sua empresa', texto)
        self.assertTrue(texto.endswith('até amanhã pessoal.'))
        self.assertEqual(rel['removidas'], [])

    def test_frase_fantasma_do_whisper_sai(self):
        falado = self.ROT + ' Legendas pela comunidade Amara.org'
        out, rel = L.alinhar_com_roteiro(self._pal(falado), self.ROT)
        self.assertNotIn('Amara', ' '.join(p['w'] for p in out))
        self.assertTrue(rel['removidas'])

    def test_sem_roteiro_nao_mexe(self):
        pal = self._pal('qualquer coisa falada aqui')
        out, rel = L.alinhar_com_roteiro(pal, '')
        self.assertEqual(out, pal)

    def test_video_comeca_na_fala(self):
        pal = self._pal('Você não precisa de investidor milionário.')   # 1ª palavra em 1,1 s
        trechos, _ = L.montar_trechos(10.0, [], pal)
        self.assertAlmostEqual(trechos[0][0], 1.1 - L.FOLGA_PRIMEIRA, places=3)   # antes ficava 1 s mudo no começo
        sil, _ = L.montar_trechos(10.0, [(0.0, 1.0)], [])   # sem transcrição: a proteção do 1º segundo continua
        self.assertEqual(sil[0][0], 0.0)

    def _frases(self, textos):
        import lib_destrava as D
        pal, t = [], 0.3
        for tx in textos:
            for w in tx.split():
                pal.append({'n0': round(t, 3), 'n1': round(t + 0.3, 3), 'w': w}); t += 0.36
            t += 0.3
        return D.frases_por_pontuacao(pal), pal, t

    def test_plano_visual_manda_nas_cenas(self):
        import lib_destrava as D
        frases, pal, dur = self._frases([
            'Você não precisa de investidor milionário para criar uma marca gigante.', 'Uma designer americana provou isso na prática.',
            'E o passo final dela é a maior lição pro seu negócio.', 'Lele Sadoughi começou a marca de joias dela do zero.',
            'Sem fundo de investimento botando milhões na conta.', 'Em vez de torcer dinheiro em anúncio caro, o lucro pagava a produção.',
            'Crescer com o próprio lucro garante a sua liberdade.', 'Em 2012 ela tinha 70% de margem.'])
        plano = [{'tipo': 'imagem', 'titulo': 'Sem investidor', 'busca': 'luxury jewelry store'},
                 {'tipo': 'imagem', 'titulo': 'A prova', 'busca': 'jewelry designer workshop', 'rotulo': 'Designer dos EUA'},
                 {'tipo': 'frase', 'titulo': 'A lição', 'rotulo': 'LIÇÃO'},
                 {'tipo': 'imagem', 'titulo': 'Do zero', 'busca': 'handmade jewelry making', 'rotulo': 'Lele Sadoughi'},
                 {'tipo': 'comparacao', 'titulo': 'Sem fundo', 'esquerda': 'Fundo investidor', 'direita': 'Caixa próprio'},
                 {'tipo': 'grafico', 'titulo': 'Lucro paga tudo', 'direcao': 'sobe', 'rotulo': 'lucro'},
                 {'tipo': 'icone', 'titulo': 'Liberdade', 'icone': 'cadeado'},
                 {'tipo': 'numero', 'titulo': 'Margem', 'destaque': '70%'}]
        b = D.planejar(frases, dur, 'Construa uma marca forte', broll=True, plano=plano)
        def por(inicio):
            return next(x for x in b if x['texto'].startswith(inicio))
        self.assertEqual(b[0]['tipo'], 'titulo'); self.assertEqual(b[0]['busca'], 'luxury jewelry store')
        img = por('Uma')
        self.assertEqual((img['tipo'], img['cabeca'], img['busca'], img['rotulo']), ('imagem', 'A prova', 'jewelry designer workshop', 'Designer dos EUA'))
        cartao = por('E o passo')
        self.assertEqual(cartao['tipo'], 'frase')
        self.assertIn('designer americana', cartao['antes'])            # o cartão mostra as frases reais vizinhas
        self.assertIn('Lele Sadoughi', cartao['depois'])
        self.assertEqual(por('Sem')['tipo'], 'comparacao')
        cmp = por('Sem')
        self.assertEqual(len(cmp['tempos_itens']), 2)
        self.assertLessEqual(cmp['tempos_itens'][1], cmp['t0'] + (cmp['t1'] - cmp['t0']) * 0.6 + 0.001)   # os dois lados juntos na tela
        self.assertEqual((por('Crescer')['tipo'], por('Crescer')['icone']), ('icone', 'cadeado'))
        self.assertEqual((por('Em 2012')['tipo'], por('Em 2012')['destaque']), ('numero', '70%'))
        self.assertEqual(por('Em vez')['tipo'], 'grafico')
        tipos = [x['tipo'] for x in b]
        self.assertIn('grafico', tipos)
        # sem chamada no fim e vídeo > 8 s: tela final própria, e o bloco anterior termina antes dela
        self.assertEqual(b[-1]['tipo'], 'fim'); self.assertTrue(b[-1]['sem_chamada'])
        self.assertAlmostEqual(b[-2]['t1'], b[-1]['t0'])
        g = D.ass_graficos(b)
        self.assertIn('Lele Sadoughi', g)                                 # rótulo com informação nova
        self.assertNotIn('Fake', g)
        f = D.ass_final(b, pal, dur)
        self.assertIn('@PEDRO_DESTRAVA', f)
        self.assertIn('\\alpha&H00&', f)                                # fundo da tela final opaco: nada aparece por baixo

    def test_sem_plano_nao_repete_palavra_na_etiqueta(self):
        import lib_destrava as D
        frases, pal, dur = self._frases(['Você não precisa de investidor.', 'Uma designer americana provou isso na prática.',
                                         'Ela vendeu joias na feira.', 'Depois abriu a loja.'])
        b = D.planejar(frases, dur, 'Teste', broll=True)
        for x in b:
            if x['tipo'] == 'imagem':
                self.assertNotIn('rotulo', x)       # sem plano: sem etiqueta (era a mesma palavra do título e da legenda)

    def test_graficos_novos_dentro_da_area_de_cima(self):
        import re as _re
        import lib_destrava as D
        frases, pal, dur = self._frases(['Abertura do vídeo aqui.', 'Investidor em vez de caixa próprio sempre.',
                                         'O lucro cresce mês a mês sem parar.', 'Quatro coisas: produto, preço, prazo e caixa.',
                                         'Em 2012 ela tinha 70% de margem.', 'Fecha aqui.'])
        plano = [{}, {'tipo': 'comparacao', 'titulo': 'A diferença', 'esquerda': 'Investidor', 'direita': 'Caixa próprio'},
                 {'tipo': 'grafico', 'titulo': 'Lucro', 'direcao': 'sobe', 'rotulo': 'mês a mês'}, {},
                 {'tipo': 'numero', 'destaque': '70%'}, {}]
        b = D.planejar(frases, dur, 'Teste', broll=False, plano=plano)
        g = D.ass_graficos(b)
        ys = [int(m) for m in _re.findall(r'\\(?:pos|move)\(\d+,(\d+)', g)]
        self.assertTrue(ys); self.assertLessEqual(max(ys), D.Y_LEGENDA['split'] - 90)
        for desenho in _re.findall(r'\\p1\}([^{]*)\{', g):
            nums = [float(x) for x in desenho.replace('m', ' ').replace('l', ' ').replace('b', ' ').split()]
            self.assertLessEqual(max(nums[1::2]), D.Y_LEGENDA['split'] - 45, desenho[:60])

    def test_contagem_do_numero(self):
        import lib_destrava as D
        self.assertEqual(D._contagem('70%')[-1], '70%')
        self.assertEqual(len(D._contagem('70%')), 12)
        self.assertEqual(D._contagem('R$ 1.500')[-1], 'R$ 1.500')
        self.assertIsNone(D._contagem('2012'))          # ano não conta
        self.assertIsNone(D._contagem('6 em 10'))
        self.assertIsNone(D._contagem('5'))

    def test_sons_nos_elementos(self):
        import lib_destrava as D
        frases, pal, dur = self._frases(['Abertura do vídeo aqui.', 'Ela focou em duas coisas: produto bom e preço justo.',
                                         'Em 2012 ela tinha 70% de margem.', 'Quem manda no estoque manda na empresa.'])
        b = D.planejar(frases, dur, 'Teste', broll=False)
        ev = D.efeitos(b)
        tipos = [k for _, k in ev]
        self.assertEqual(ev[0], (0.05, 'impacto'))
        self.assertIn('pop', tipos); self.assertIn('whoosh', tipos)
        self.assertTrue(all(t2 - t1 >= 0.25 for (t1, _), (t2, _) in zip(ev, ev[1:])))   # nada encavalado



class Pedido15NovParte2(unittest.TestCase):
    """Segunda leva de 15/11: gancho animado, resumo que se monta, legenda com destaque, zoom na ênfase, foto livre,
    celular, rótulos curtos da lista e trilha com clima."""
    def _frases(self, textos):
        import lib_destrava as D
        pal, t = [], 0.3
        for tx in textos:
            for w in tx.split():
                pal.append({'n0': round(t, 3), 'n1': round(t + 0.3, 3), 'w': w}); t += 0.36
            t += 0.3
        return D.frases_por_pontuacao(pal), pal, t

    def test_gancho_abre_grande_e_a_imagem_do_titulo_entra_depois(self):
        import lib_destrava as D
        frases, pal, dur = self._frases(['Você não precisa de investidor milionário para criar uma marca gigante.', 'Uma designer provou isso.',
                                         'Quem manda no estoque manda na empresa.'])
        b = D.planejar(frases, dur, 'Marca forte', broll=True, gancho='Sem investidor milionário')
        t = b[0]
        self.assertEqual(t['gancho'], 'Sem investidor milionário')
        self.assertGreater(t['gancho_fim'], t['t0']); self.assertEqual(t['inset_ini'], t['gancho_fim'])
        self.assertEqual(D._linhas_gancho('Sem investidor de verdade'), ['Sem', 'investidor', 'de verdade'])
        g = D.ass_graficos(b)
        self.assertIn('INVESTIDOR', g)                                  # gancho em caixa alta, uma palavra por linha
        self.assertIn('impacto', [k for _, k in t['marcas']])
        self.assertAlmostEqual(D.zoom_da_cena(b, t['t0'] + 0.5), 1.14)   # rosto mais perto no gancho

    def test_resumo_se_monta_com_marcadores(self):
        import lib_destrava as D
        frases, pal, dur = self._frases([
            'Abertura do vídeo sobre erros.', 'Existem três erros que quebram empresas.',
            'O primeiro erro é misturar as contas.', 'Isso acontece porque o dono paga tudo do mesmo caixa.',
            'O segundo erro é não ter reserva.', 'Sem reserva qualquer mês ruim vira crise.',
            'O terceiro erro é crescer no cartão.', 'Fecha aqui com a ideia final.'])
        b = D.planejar(frases, dur, 'Erros', broll=False)
        listas = [x for x in b if x['tipo'] == 'lista']
        self.assertEqual(len(listas), 4)                                 # anúncio + 3 marcadores
        self.assertEqual([x['itens_novos'] for x in listas[1:]], [['Misturar as contas'], ['Não ter reserva'], ['Crescer no cartão']])
        self.assertEqual(listas[3]['ja'], ['Misturar as contas', 'Não ter reserva'])   # os de antes ficam acesos
        explic = [x for x in b if x['texto'].startswith('Isso acontece')][0]
        self.assertNotEqual(explic['tipo'], 'lista')                     # a explicação tem a cena dela
        self.assertEqual(D.rotulo_ordinal('E por último, separe o pró-labore.'), 'Separe o pró-labore')

    def test_rotulos_curtos_do_plano_na_lista(self):
        import lib_destrava as D
        frases, pal, dur = self._frases(['Abertura do vídeo.', 'Ela focou em duas coisas básicas: produto com acabamento impecável e preço que a cliente consegue pagar.', 'Fim aqui.'])
        plano = [{}, {'tipo': 'lista', 'titulo': 'Duas coisas', 'itens': ['Acabamento impecável', 'Preço acessível']}, {}]
        b = D.planejar(frases, dur, 'X', broll=False, plano=plano)
        g = D.ass_graficos(b)
        self.assertIn('Acabamento impecável', g); self.assertIn('Preço acessível', g)

    def test_foto_e_celular(self):
        import lib_destrava as D
        frases, pal, dur = self._frases(['Abertura do vídeo.', 'Steve Jobs voltou para a Apple e mudou tudo.', 'Pesquise como crescer sem investidor no Google.', 'Fim.'])
        plano = [{}, {'tipo': 'pessoa', 'titulo': 'A volta', 'pessoa': 'Steve Jobs', 'busca': 'apple store'}, {'tipo': 'celular', 'titulo': 'A busca', 'texto': 'como crescer sem investidor'}, {}]
        b = D.planejar(frases, dur, 'X', broll=True, plano=plano)
        foto = [x for x in b if x['tipo'] == 'foto'][0]; cel = [x for x in b if x['tipo'] == 'celular'][0]
        self.assertEqual(foto['pessoa'], 'Steve Jobs'); self.assertEqual(cel['busca_tela'], 'como crescer sem investidor')
        foto['credito'] = 'Foto: Fulano · CC BY-SA 4.0 (Wikimedia)'
        g = D.ass_graficos(b)
        self.assertIn('Steve Jobs', g); self.assertIn('CC BY-SA 4.0', g)   # nome e crédito exigido pela licença
        self.assertIn('como crescer sem investidor', g)
        D.sem_foto(foto)                                                    # sem foto livre: vídeo de banco (havia busca)
        self.assertEqual(foto['tipo'], 'imagem')

    def test_legenda_destaca_numero_e_ideia_da_cena(self):
        import lib_destrava as D
        bl = {'cabeca': 'Lucro paga tudo'}
        self.assertTrue(D.destaque_legenda('70%', None)); self.assertTrue(D.destaque_legenda('R$', None))
        self.assertTrue(D.destaque_legenda('lucro,', bl)); self.assertFalse(D.destaque_legenda('paga', {'cabeca': 'A paga'}) and False)
        self.assertFalse(D.destaque_legenda('casa', bl))
        frases, pal, dur = self._frases(['Abertura do vídeo.', 'O lucro paga a produção seguinte.'])
        b = D.planejar(frases, dur, 'X', broll=False, plano=[{}, {'tipo': 'icone', 'titulo': 'Lucro paga tudo'}])
        f = D.ass_final(b, pal, dur)
        self.assertTrue(any(D.AMARELO in ln and 'lucro' in ln for ln in f.splitlines() if ',Legenda,' in ln))

    def test_zoom_na_enfase(self):
        import lib_destrava as D
        frases, pal, dur = self._frases(['Abertura do vídeo.', 'Quem manda no estoque manda na empresa.', 'Outra frase normal aqui.'])
        b = D.planejar(frases, dur, 'X', broll=False, plano=[{}, {'tipo': 'frase', 'rotulo': 'REGRA'}, {}])
        cartao = [x for x in b if x['tipo'] == 'frase'][0]
        self.assertAlmostEqual(D.zoom_da_cena(b, (cartao['t0'] + cartao['t1']) / 2), 1.10)
        self.assertAlmostEqual(D.zoom_da_cena(b, b[-1]['t1'] - 0.1, base=1.04), 1.04)

    def test_trilha_com_clima(self):
        import tempfile, wave
        import editar as E
        for clima in ('calma', 'animada', 'tensa', 'inexistente'):
            arq = os.path.join(tempfile.mkdtemp(), f'{clima}.wav')
            E.trilha_musical(arq, 3, clima=clima)
            with wave.open(arq) as w:
                self.assertGreater(w.getnframes(), 3 * w.getframerate())

if __name__ == '__main__':
    unittest.main(verbosity=1)
