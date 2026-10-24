---
titulo: Teste tecnico do template mapa (interno, nao publicar)
template: mapa
duracao: 12-18
---
<!-- fontes: prototipo tecnico interno da Fase 1; nao sera publicado. -->
<!-- fontes: rotas tracadas sobre estradas reais do Natural Earth; numero das BRs inferido pelas cidades de passagem (mapa_rotas.yaml) — verificar no DNIT/SNV. -->

## Cena 1
fala: Essas {linhas|previa} não foram numeradas por {acaso|limpar}.
camera: foco=Brasil zoom=1.05
previa: sim

## Cena 2
fala: Tudo começa em {Brasília}. Dela saem a {BR-060}, a {BR-070} e a {BR-050}.
camera: foco=Brasília zoom=2.2
mostrar: Brasília, BR-060, BR-070, BR-050

## Cena 3
fala: E a {BR-040} desce até o {Rio de Janeiro}.
camera: foco=BR-040 zoom=auto
destacar: BR-040
mostrar: Rio de Janeiro
