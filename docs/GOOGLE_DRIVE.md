# Configurar Google Shared Drive

1. Crie um projeto no Google Cloud.
2. Ative a Google Drive API.
3. Crie uma conta de serviço.
4. Gere uma chave JSON.
5. Crie uma pasta raiz dentro de um **Shared Drive**.
6. Adicione o e-mail da conta de serviço como membro com permissão para organizar conteúdo.
7. Copie o ID da pasta raiz da URL.

Configure no Cloudflare:

```powershell
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
npx wrangler secret put GOOGLE_DRIVE_ROOT_FOLDER_ID
```

Informe a chave privada completa, incluindo `BEGIN PRIVATE KEY` e `END PRIVATE KEY`. O Worker aceita quebras reais ou sequências `\n`.

Não use uma pasta comum do “Meu Drive”. Contas de serviço não têm cota de armazenamento própria. O Shared Drive possui o armazenamento e permite o acesso da conta técnica.

Após o primeiro upload, confirme a criação das pastas descritas em `ARQUITETURA_VERSIONAMENTO.md`.

