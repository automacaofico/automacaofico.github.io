# Dados cartográficos

`fico-station-tracks.json` contém 11 eixos ferroviários extraídos dos KMZ fornecidos.

`pendencias-iniciais.json` contém a leitura inicial da planilha entregue, com 1.895 pendências.

## Localização

- Registros são associados pelo pacote e quilômetro médio.
- Intervalos usam a média entre quilômetros inicial e final.
- Extrapolações ficam limitadas a 500 metros.
- Registros incompatíveis permanecem sem localização.

## Resultado inicial

- 1.847 pendências localizadas.
- 48 pendências sem localização.
- 51 posições usam extrapolação curta.

Novas planilhas substituem esses registros somente durante a sessão atual.
