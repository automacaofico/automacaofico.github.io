# FICO Versioning API

Cloudflare Worker responsável por autenticação, validação de planilhas, comparação, histórico no Shared Drive, publicação no GitHub e restauração segura.

## Comandos

```powershell
npm ci
npm test
npm run check
npm run dev
npm run deploy
```

## API

- `GET /api/v1/health`
- `GET /api/v1/dashboards`
- `POST /api/v1/auth/session`
- `POST /api/v1/uploads`
- `GET /api/v1/dashboards/:id/versions`
- `GET /api/v1/dashboards/:id/comparison`
- `GET /api/v1/dashboards/:id/compare?from=&to=`
- `POST /api/v1/dashboards/:id/restore`

A raiz `POST /` mantém compatibilidade com a página antiga.

Consulte `../docs/` para arquitetura e publicação.

