# Operação e recuperação

## Saúde do serviço

- `GET /health` confirma que o Worker está respondendo.
- `GET /ready` confirma que o Worker e o banco D1 estão acessíveis.
- Toda resposta recebe `x-request-id`. Em uma falha, o mesmo identificador é retornado no JSON e pode ser localizado nos logs do Worker.
- Erros inesperados são registrados de forma estruturada como `request_failed` e retornam JSON com CORS e status `503`, evitando o erro genérico `Failed to fetch` no navegador.

## Backup do D1

O backup é somente leitura e não remove nem altera histórico. Gere uma cópia SQL versionada com:

```powershell
npx wrangler d1 export fico-tracking --remote --output "backups/fico-tracking-AAAA-MM-DD.sql"
```

Antes de considerar a cópia válida, execute `PRAGMA integrity_check;` no banco e confirme que o arquivo SQL foi baixado integralmente e aberto em uma base de teste.

## Recuperação

Não execute restauração em produção sem uma janela aprovada. Primeiro importe a cópia em uma base D1 de teste, valide as tabelas e a contagem de registros. A restauração de uma base aprovada usa:

```powershell
npx wrangler d1 execute fico-tracking --remote --file "backups/fico-tracking-AAAA-MM-DD.sql"
```

O procedimento acima pode sobrescrever dados; por isso é exclusivamente uma ação manual, revisada e documentada. A retenção recomendada é 30 cópias diárias, 12 mensais e uma cópia antes de toda mudança estrutural.
