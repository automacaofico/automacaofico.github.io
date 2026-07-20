# Desenvolvimento, testes e publicação

## Worker local

Copie `worker/.env.example` para `worker/.dev.vars` e preencha valores de homologação. Esse arquivo está ignorado pelo Git.

```powershell
cd worker
npm ci
npm test
npm run dev
```

## Site local

Na raiz do repositório:

```powershell
python -m http.server 8000
```

Configure temporariamente a URL local:

```javascript
localStorage.setItem('fico_versioning_api', 'http://127.0.0.1:8787');
```

Abra `http://127.0.0.1:8000/atualizar.html` e `http://127.0.0.1:8000/evolucao/`.

## Homologação mínima

1. Upload inválido deve preservar a versão atual.
2. Upload idêntico deve retornar duplicata.
3. Upload válido deve aparecer no GitHub e Shared Drive.
4. Evolução deve listar a nova versão.
5. Comparação deve separar novas, removidas e alteradas.
6. Restauração deve criar uma nova versão, nunca apagar histórico.
7. Tema claro, escuro e impressão devem permanecer legíveis.

## Publicação do site

Somente após a API responder e a homologação passar:

```powershell
git status
git add atualizar.html index.html mapa-superestrutura/index.html evolucao worker docs versoes.html
git commit -m "feat: adiciona versionamento e evolução da obra"
git push origin main
```

O GitHub Pages publica a raiz do branch `main`. O upload moderno mantém o mesmo arquivo público dos dashboards atuais.

## Recuperação

- Falha durante upload: o Worker marca o estágio como falho e preserva a base atual.
- Falha após publicar: o Worker tenta restaurar GitHub, Drive e índice.
- Restauração manual: use a linha do tempo em “Evolução da Obra”. Ela publica uma nova versão baseada na escolhida.
- Falha crítica de credenciais: corrija o segredo, verifique os logs do Worker e repita. Não exclua arquivos do Drive manualmente.

