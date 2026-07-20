# Publicar o Worker

## Pré-requisitos

- Node.js 20 ou superior.
- Conta Cloudflare autenticada pelo Wrangler.
- Shared Drive configurado.
- token GitHub com permissão `Contents: Read and write` somente nos repositórios usados.

## Instalação

```powershell
cd worker
npm ci
npx wrangler login
```

## Gerar segredos

Hash da senha operacional:

```powershell
node -e "require('crypto').createHash('sha256').update(process.argv[1]).digest('hex')" "SENHA-FORTE"
```

Chave de sessão:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Grave cada valor:

```powershell
npx wrangler secret put ACCESS_PASSWORD_HASH
npx wrangler secret put SESSION_SIGNING_KEY
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
npx wrangler secret put GOOGLE_DRIVE_ROOT_FOLDER_ID
npx wrangler secret put GITHUB_TOKEN
```

## Publicação

```powershell
npm test
npm run check
npm run deploy
```

Copie a URL final. Antes de publicar o site, defina a API no HTML, num arquivo carregado antes dos aplicativos:

```html
<script>window.FICO_VERSIONING_API = 'https://fico-versioning-api.SUA-CONTA.workers.dev';</script>
```

Alternativamente, durante homologação:

```javascript
localStorage.setItem('fico_versioning_api', 'https://fico-versioning-api.SUA-CONTA.workers.dev');
```

Teste a saúde:

```powershell
curl.exe https://fico-versioning-api.SUA-CONTA.workers.dev/api/v1/health
```

## Rotação

Use novamente `wrangler secret put`. Trocar `SESSION_SIGNING_KEY` encerra todas as sessões existentes. Trocar a senha exige recalcular `ACCESS_PASSWORD_HASH`.

