#!/usr/bin/env node
/* Publica os dados do Relatório Diário no site, a partir de uma exportação do banco do artefato.
 * Uso:  node relatorio-diario/sync-local.js <pasta-da-exportacao> [--marcar]
 *
 * - A senha vem da variável RELATORIO_SENHA ou do arquivo ~/.fico-relatorio/senha.txt (fora do repositório).
 * - Compara com a última publicação (hash guardado em ~/.fico-relatorio/ultimo-hash.txt); sem mudança, não faz nada.
 * - --marcar: só grava o hash da exportação como "já publicado", sem publicar.
 * Saída final: SEM_MUDANCAS, PUBLICADO ou ERRO: <motivo> (código 1). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const CONFIG = path.join(os.homedir(), '.fico-relatorio');
const INCLUIR = ['dias', 'egp', 'gsa', 'gsaConversa', 'planta', 'config'];
const src = process.argv[2];
const so_marcar = process.argv.includes('--marcar');

function falha(msg) { console.log('ERRO: ' + msg); process.exit(1); }
if (!src || !fs.existsSync(src)) falha('pasta da exportação não informada ou inexistente');

// hash estável do conteúdo exportado (ordem fixa de coleções e documentos)
const h = crypto.createHash('sha256');
let total = 0, dias = 0;
for (const col of INCLUIR) {
  const dir = path.join(src, col);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    h.update(col + '/' + f + '\n' + fs.readFileSync(path.join(dir, f), 'utf8') + '\n');
    total++; if (col === 'dias') dias++;
  }
}
const hash = h.digest('hex');
// trava de segurança: uma exportação incompleta nunca sobrescreve o site
if (total < 100 || dias < 10) falha('exportação incompleta (' + total + ' documentos, ' + dias + ' dias); nada foi publicado');

fs.mkdirSync(CONFIG, { recursive: true });
const arqHash = path.join(CONFIG, 'ultimo-hash.txt');
const ultimo = fs.existsSync(arqHash) ? fs.readFileSync(arqHash, 'utf8').trim() : '';
if (so_marcar) { fs.writeFileSync(arqHash, hash); console.log('MARCADO ' + hash.slice(0, 12)); process.exit(0); }
if (hash === ultimo) { console.log('SEM_MUDANCAS'); process.exit(0); }

let senha = process.env.RELATORIO_SENHA || '';
if (!senha) { try { senha = fs.readFileSync(path.join(CONFIG, 'senha.txt'), 'utf8').trim(); } catch (e) { /* sem arquivo */ } }
if (!senha) falha('senha do site não encontrada (arquivo ' + path.join(CONFIG, 'senha.txt') + ')');

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  git('pull', '--rebase', '--autostash');
  execFileSync(process.execPath, [path.join(__dirname, 'build-snapshot.js'), src], { cwd: REPO, env: { ...process.env, RELATORIO_SENHA: senha }, stdio: ['ignore', 'pipe', 'pipe'] });
  git('add', 'relatorio-diario/data/relatorio.enc.json');
  git('commit', '-m', 'Relatório Diário: atualização automática dos dados do site');
  git('push', 'origin', 'HEAD');
} catch (e) {
  falha(String((e.stderr || e.message || e)).split('\n').filter(Boolean).slice(-2).join(' · ').slice(0, 300));
}
fs.writeFileSync(arqHash, hash);
console.log('PUBLICADO ' + hash.slice(0, 12));
