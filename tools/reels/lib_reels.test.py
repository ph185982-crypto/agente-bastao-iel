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
        self.assertEqual([s['zoom'] for s in segs], [1.0, 1.12, 1.0])
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
        self.assertEqual(L.filtro_rotacao(-90), 'transpose=1')
        self.assertEqual(L.filtro_rotacao(90), 'transpose=2')
        self.assertEqual(L.filtro_rotacao(180), 'transpose=1,transpose=1')
        self.assertEqual(L.filtro_rotacao(0), '')


class Legendas(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main(verbosity=1)
