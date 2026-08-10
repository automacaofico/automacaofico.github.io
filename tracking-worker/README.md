# API de Rastreamento FICO

API Cloudflare Worker + D1 para receber posições autenticadas e publicar a localização dos equipamentos.

## Rotas

- `POST /api/v1/positions` — envio autenticado pelo aplicativo Android.
- `POST /api/v1/owntracks` — envio HTTPS do OwnTracks com autenticação por equipamento.
- `POST /api/v1/activate` — troca um código descartável pela credencial do aparelho.
- `POST /api/v1/operators` — cadastra ou redefine um operador com autorização da coordenação.
- `GET /api/v1/operator/session?equipmentId=...` — consulta o operador atualmente associado.
- `POST /api/v1/operator/session/start` — abre ou transfere um turno operacional.
- `POST /api/v1/operator/session/end` — encerra o turno autenticado do operador.
- `GET /api/v1/equipment/latest` — posição pública atual da frota.
- `GET /api/v1/equipment/:id/history` — histórico público de até sete dias.
- `GET /health` — diagnóstico do serviço.

O token do dispositivo nunca deve ser versionado. Somente seu SHA-256 é armazenado no D1.
