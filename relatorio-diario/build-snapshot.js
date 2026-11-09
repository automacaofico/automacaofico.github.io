#!/usr/bin/env node
/* Gera data/relatorio.enc.json (dados CRIPTOGRAFADOS) a partir de uma exportação do banco do artefato.
 *
 * Uso:   RELATORIO_SENHA='...' node relatorio-diario/build-snapshot.js <pasta-da-exportacao> [saida.json]
 *
 * A pasta tem uma subpasta por coleção (dias, egp, gsa, gsaConversa, planta, config), com um .json por
 * documento (formato gerado pelo ArtifactData com out_dir).
 *
 * Segurança: o GitHub Pages é estático e público, então a senha NÃO é conferida no servidor — os dados é que são
 * criptografados (AES-256-GCM, chave derivada da senha por PBKDF2-SHA256), e a página os abre no navegador.
 * A senha nunca é gravada no repositório. Quanto mais longa a senha, mais difícil de adivinhar por tentativa. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const src = process.argv[2];
const out = process.argv[3] || path.join(__dirname, 'data', 'relatorio.enc.json');
const senha = process.env.RELATORIO_SENHA;
if (!src || !senha) { console.error('Uso: RELATORIO_SENHA=... node build-snapshot.js <pasta-da-exportacao> [saida.json]'); process.exit(1); }

const INCLUIR = ['dias', 'egp', 'gsa', 'gsaConversa', 'planta', 'config'];
const collections = {};
let total = 0;
for (const col of INCLUIR) {
  const dir = path.join(src, col);
  if (!fs.existsSync(dir)) continue;
  collections[col] = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    collections[col][f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    total++;
  }
}
const generatedAt = new Date().toISOString();
const plain = zlib.gzipSync(Buffer.from(JSON.stringify({ generatedAt, collections }), 'utf8'), { level: 9 });

const ITER = 600000;
const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(senha, salt, ITER, 32, 'sha256');
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]); // WebCrypto espera o tag no fim

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, gz: true, generatedAt,
  salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64')
}));
console.log('ok:', total, 'documentos ->', out, '(' + Math.round(fs.statSync(out).size / 1024) + ' KB, criptografado)');
