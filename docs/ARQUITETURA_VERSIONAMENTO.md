# Arquitetura de versionamento FICO

## Estado confirmado

O portal é estático e publicado pelo GitHub Pages no repositório `automacaofico/automacaofico.github.io`. Cada dashboard lê uma planilha pública de um repositório próprio. A página `atualizar.html` usava o Worker `fico-uploader` para substituir diretamente esse arquivo no GitHub.

## Nova arquitetura

```text
atualizar.html / evolucao/
          │ HTTPS + sessão assinada
          ▼
Cloudflare Worker + Durable Object
          ├── valida arquivo e estrutura
          ├── normaliza células e chaves
          ├── compara com a versão vigente
          ├── grava histórico no Shared Drive
          └── publica a nova base no GitHub
                         │
                         ▼
                 dashboards existentes
```

O GitHub continua sendo a fonte pública atual. O Google Shared Drive vira o arquivo histórico privado. Assim, URLs e dashboards existentes permanecem compatíveis.

## Fluxo transacional

1. Autentica usuário e limita tentativas.
2. Valida extensão, assinatura ZIP, tamanho, abas e colunas.
3. Calcula SHA-256 e bloqueia duplicata.
4. Importa a base pública como versão inicial, quando necessário.
5. Grava Excel e JSON normalizado como `staged`.
6. Calcula diferenças sem depender da ordem das linhas.
7. Publica no GitHub.
8. Promove arquivos no Drive e atualiza o índice.
9. Em falha final, restaura GitHub, base atual e índice.

O Durable Object serializa alterações por dashboard. Duas atualizações simultâneas não podem disputar a mesma versão vigente.

## Organização no Shared Drive

Cada dashboard recebe estas pastas:

- `BASE_ATUAL`: Excel e JSON vigentes.
- `HISTORICO`: todas as planilhas publicadas.
- `JSON`: versões normalizadas.
- `COMPARACOES`: diferenças calculadas.
- `_TRANSACOES`: arquivos em preparação.
- `LOGS`: auditoria por transação.

## Estratégias de identidade

| Dashboard | Identificação principal |
|---|---|
| Superestrutura | coordenada matricial; materiais por descrição/unidade; lastro por data/mês |
| Pendências R1 | pacote/empresa/tipo e demais chaves declaradas |
| Mapa de Pendências | `ID ATLAS` |
| Infraestrutura R1 | `Id_Pendencia`; pacote/serviço; pacote/ativo/trecho |
| Infraestrutura R2 | coordenada matricial e rótulos consolidados |

Datas, números, percentuais, textos e quilômetros são normalizados antes da comparação. Correções apenas administrativas aparecem separadas das mudanças de negócio.

## Segurança

- Nenhuma credencial chega ao navegador.
- Segredos ficam no Cloudflare.
- A senha vira hash SHA-256.
- Sessões são assinadas e expiram.
- CORS aceita somente origens declaradas.
- Upload aceita apenas `.xlsx`, até 10 MiB por padrão.
- Arquivos `.xlsm` e macros são recusados.
- Fórmulas não são executadas pelo Worker.
- Logs nunca armazenam a senha.

## Limitações conhecidas

- A conta de serviço precisa participar de um Shared Drive. Conta de serviço não possui cota própria para ser dona de arquivos.
- A comparação matricial usa posição e rótulos. Mudanças estruturais extensas podem aparecer como várias alterações.
- O novo dashboard só possui histórico real após duas versões. Na primeira, ele informa a criação da linha de base.
- A publicação depende das APIs Google Drive e GitHub.

