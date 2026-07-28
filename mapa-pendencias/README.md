# FICO — Mapa de Pendências

Dashboard independente para carregar planilhas Excel e localizar pendências sobre o traçado ferroviário FICO.

## Uso

1. Execute `start_dashboard.cmd`.
2. Abra `http://127.0.0.1:8010`.
3. Clique em **Carregar Excel**.
4. Selecione a planilha operacional EAP com a aba `Banco de Dados`.

A planilha anterior, com a aba `Pendências`, continua aceita para contingência e
consulta de versões históricas.

O arquivo é processado somente no navegador. Nenhum dado é enviado para servidor.

## Campos reconhecidos

Na EAP, o identificador oficial é `Id_Pendencia`, lido diretamente da aba
`Banco de Dados`. O dashboard também reconhece empresa, pacote, segmento, ativo,
lado, atividade, classificação, descrição, KM inicial/final, status,
responsáveis, datas, priorização, equipe, protocolo e certificação.

Linhas de totalização ou sem identificador numérico não são carregadas.

## Tecnologia

- MapLibre GL JS 5.24.0.
- SheetJS Community Edition 0.20.3.
- OpenStreetMap e Esri World Imagery.
- Traçados convertidos dos KMZ fornecidos.

O dashboard não depende do ATLAS.
