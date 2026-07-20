# FICO — Mapa de Pendências

Dashboard independente para carregar planilhas Excel e localizar pendências sobre o traçado ferroviário FICO.

## Uso

1. Execute `start_dashboard.cmd`.
2. Abra `http://127.0.0.1:8010`.
3. Clique em **Carregar Excel**.
4. Selecione uma planilha com aba `Pendências`.

O arquivo é processado somente no navegador. Nenhum dado é enviado para servidor.

## Campos reconhecidos

`ID ATLAS`, `Empresa`, `Pacote`, `Trecho`, `Ativo`, `Lado`, `Especialidade`, `Classificação`, `Descrição`, `KM inicial`, `KM final`, `Status`, `Responsável FICO`, `Responsável contratada`, `Abertura`, `Prazo`, `Previsão de baixa`, `Baixa` e `Última atualização`.

## Tecnologia

- MapLibre GL JS 5.24.0.
- SheetJS Community Edition 0.20.3.
- OpenStreetMap e Esri World Imagery.
- Traçados convertidos dos KMZ fornecidos.

O dashboard não depende do ATLAS.
