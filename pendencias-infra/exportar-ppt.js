/* Exportar PPT — Reunião semanal INFRA
 * Monta o PowerPoint no navegador (pptxgenjs). Nada é enviado para servidor:
 * fotos e imagens do modelo são lidas da pasta "Consolidado" escolhida pelo usuário
 * (Atualização › Consolidado, sincronizada pelo OneDrive), que contém:
 *   Fotos/<ID>_Pendencia.* e <ID>_Resolucao.*   → colunas "Registro fotográfico (INFRA)" e "(FICO)"
 *   Modelo PPT/capa.jpg, sumario.jpg, fluxo.jpg, logo-vale.png
 * Estrutura (igual à apresentação semanal): Capa · Sumário · Fluxo · Avanço · Pendências por pacote ·
 * Pendência não conforme · Novas pendências · Retornos/Pontos de atenção/Próximos passos (estes 3 para preencher).
 */
(function () {
  const W = 26.667, H = 15;                     // mesmo tamanho de slide do modelo (24384000 x 13716000 EMU)
  const VERDE = '00645F', CLARO = 'D9F2D0', BARRA = '0ABB98', TEAL = '007E79', CINZA = '474747', TXT = '262626';
  const FONTE = 'Arial Nova Cond';
  const MESES = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  const fmt = n => (n == null || n === '' || Number.isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR');
  const pctTxt = (a, b) => (b ? Math.round(a * 100 / b) + '%' : '—');

  /* ---------- arquivos locais ---------- */
  function indexar(arquivos) {
    const fotos = new Map(), modelo = new Map();
    (arquivos || []).forEach(({ path, file }) => {
      const p = (path || file.webkitRelativePath || file.name).replace(/\\/g, '/');
      const nome = p.split('/').pop();
      if (/\/Modelo PPT\//i.test('/' + p)) modelo.set(nome.toLowerCase(), file);
      else if (/^P\d{2}-\d{3}_(Pendencia|Resolucao)\./i.test(nome)) fotos.set(nome.replace(/\.[^.]+$/, '').toUpperCase(), file);
    });
    return { fotos, modelo };
  }
  async function imagem(blob, maxPx, q) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    return { data: c.toDataURL('image/jpeg', q).replace(/^data:/, ''), w: c.width, h: c.height };
  }
  async function bruto(blob) {           // imagens do modelo: mantém o arquivo original
    const url = await new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = err; r.readAsDataURL(blob); });
    const bmp = await createImageBitmap(blob); const d = { data: url.replace(/^data:/, ''), w: bmp.width, h: bmp.height }; bmp.close && bmp.close(); return d;
  }
  function caber(img, x, y, w, h) {      // "contain" centralizado
    const k = Math.min(w / img.w, h / img.h), iw = img.w * k, ih = img.h * k;
    return { data: img.data, x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih };
  }

  /* ---------- elementos comuns ---------- */
  function moldura(pres, s, logo, titulo, ty, semLogo) {
    s.background = { color: 'FFFFFF' };
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.39, h: H, fill: { color: BARRA }, line: { color: BARRA } });
    s.addText('FICO', { x: 1.0, y: 0.12, w: 1.2, h: 0.29, fontFace: FONTE, fontSize: 11, color: CINZA, margin: 0, isTextBox: true });
    if (semLogo) { /* slides de pacote: a tabela ocupa até o rodapé, como no modelo */ }
    else if (logo) s.addImage(caber(logo, 24.07, 13.71, 1.94, 0.74));
    else s.addText('VALE', { x: 24.07, y: 13.71, w: 1.94, h: 0.74, fontFace: FONTE, fontSize: 24, bold: true, color: TEAL, align: 'right', isTextBox: true });
    if (titulo) s.addText(titulo, { x: 1.37, y: ty ?? 0.45, w: 23.5, h: 1.05, fontFace: FONTE, fontSize: 46, bold: true, color: VERDE, margin: 0, valign: 'middle', isTextBox: true });
  }
  function caixa(pres, s, x, y, w, h, texto, o = {}) {
    const escuro = o.escuro;
    s.addText(texto, {
      shape: o.reto ? pres.shapes.RECTANGLE : pres.shapes.ROUNDED_RECTANGLE, rectRadius: o.raio ?? 0.08,
      x, y, w, h, fill: { color: escuro ? VERDE : CLARO }, line: { color: escuro ? VERDE : CLARO },
      fontFace: FONTE, fontSize: o.size || 28, bold: o.bold !== false, color: escuro ? 'FFFFFF' : VERDE,
      align: 'center', valign: 'middle', margin: 0.05,
      shadow: { type: 'outer', color: '000000', opacity: 0.25, blur: 3, offset: 1.5, angle: 90 },
    });
  }
  function cartao(pres, s, x, y, w, h, cab, valor, o = {}) {   // cabeçalho escuro + corpo (claro ou escuro)
    const hc = o.hc || 0.8;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.18, fill: { color: o.corpoEscuro ? VERDE : CLARO }, line: { color: o.corpoEscuro ? VERDE : CLARO },
      shadow: { type: 'outer', color: '000000', opacity: 0.25, blur: 3, offset: 1.5, angle: 90 } });
    s.addText(cab, { shape: pres.shapes.RECTANGLE, x, y, w, h: hc, fill: { color: VERDE }, line: { color: VERDE }, fontFace: FONTE, fontSize: o.sizeCab || 32, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0.05 });
    s.addText(valor, { x, y: y + hc, w, h: h - hc, fontFace: FONTE, fontSize: o.sizeVal || 36, bold: true, color: o.corpoEscuro ? 'FFFFFF' : VERDE, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
  }
  function seta(pres, s, x, y, w) {
    s.addShape(pres.shapes.LINE, { x, y, w, h: 0, line: { color: '1F4E79', width: 3, endArrowType: 'triangle' } });
  }

  /* ---------- slides ---------- */
  function capa(pres, img, data) {
    const s = pres.addSlide();
    if (img) s.addImage({ data: img.data, x: 0, y: 0, w: W, h: H });
    else { s.background = { color: 'FFFFFF' }; s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 5, fill: { color: TEAL }, line: { color: TEAL } }); }
    s.addText('FICO', { x: 0.75, y: 8.05, w: 10, h: 1.25, fontFace: FONTE, fontSize: 72, bold: true, color: TEAL, margin: 0, isTextBox: true });
    s.addText('Pendências INFRA', { x: 0.75, y: 9.25, w: 12, h: 0.95, fontFace: FONTE, fontSize: 48, color: TEAL, margin: 0, isTextBox: true });
    s.addText(`${MESES[data.getMonth()]} ${data.getFullYear()}`, { x: 0.72, y: 14.25, w: 6, h: 0.45, fontFace: FONTE, fontSize: 20, bold: true, color: TEAL, margin: 0, isTextBox: true });
  }
  function imagemCheia(pres, img, alt, fallbackTitulo, fallbackLinhas, logo) {
    const s = pres.addSlide();
    if (img) { s.addImage({ data: img.data, x: 0, y: 0, w: W, h: H, altText: alt }); return; }
    moldura(pres, s, logo, fallbackTitulo);
    s.addText(fallbackLinhas.map((t, i) => ({ text: t, options: { breakLine: i < fallbackLinhas.length - 1 } })),
      { x: 1.37, y: 2.2, w: 23, h: 10, fontFace: FONTE, fontSize: 28, color: '555555', valign: 'top', paraSpaceAfter: 18, isTextBox: true });
  }
  function avanco(pres, logo, n, antigas, novas) {
    const s = pres.addSlide(); moldura(pres, s, logo, 'Avanço das pendências validadas', 1.05);
    caixa(pres, s, 1.37, 2.28, 7.7, 0.77, 'Total Pendencias INFRA S.A', { escuro: true, size: 32, reto: true });
    caixa(pres, s, 1.37, 3.28, 2.37, 0.78, 'Antigas', { escuro: true, size: 28 });
    caixa(pres, s, 3.93, 3.28, 5.13, 0.78, fmt(antigas), { size: 28 });
    s.addText('+', { x: 3.93, y: 4.08, w: 5.13, h: 0.42, fontFace: FONTE, fontSize: 32, bold: true, color: VERDE, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    caixa(pres, s, 1.37, 4.55, 2.37, 0.8, 'Novas', { escuro: true, size: 28 });
    caixa(pres, s, 3.95, 4.55, 5.13, 0.8, fmt(novas), { escuro: true, size: 28 });
    cartao(pres, s, 9.52, 2.28, 7.68, 3.2, 'Total Validadas', fmt(n.validadas), { sizeCab: 36, sizeVal: 36 });
    // Avanço = validadas ÷ antigas (definição da reunião INFRA)
    cartao(pres, s, 17.52, 2.28, 7.85, 3.2, 'Avanço', antigas ? pctTxt(n.validadas, antigas) : '—', { sizeCab: 36, sizeVal: 36 });
    caixa(pres, s, 1.3, 5.82, 24.07, 0.8, 'Pendências validadas por pacote', { escuro: true, size: 32, reto: true });
    const xs = [1.28, 10.35, 18.58];
    n.porPacote.forEach((p, i) => {
      const x = xs[i] ?? (1.28 + i * 8.6);
      caixa(pres, s, x, 6.97, 2.38, 0.75, p.nome.replace('Pacote 0', 'Pacote '), { escuro: true, size: 28 });
      seta(pres, s, x + 2.52, 7.345, 0.8);
      caixa(pres, s, x + 3.52, 6.97, 3.2, 0.75, fmt(p.validadas), { size: 28 });
    });
    s.addText('Resumo das pendências concluídas vs Aguardando validação da INFRA', { x: 1.37, y: 8.6, w: 23.5, h: 0.95, fontFace: FONTE, fontSize: 46, bold: true, color: VERDE, margin: 0, valign: 'middle', isTextBox: true });
    cartao(pres, s, 1.48, 10.35, 6.18, 1.53, 'Concluídas e aguardando validação INFRA', fmt(n.aguardando), { hc: 0.53, sizeCab: 20, sizeVal: 32, corpoEscuro: true });
    s.addText('+', { x: 7.66, y: 10.75, w: 1.44, h: 0.6, fontFace: FONTE, fontSize: 32, bold: true, color: VERDE, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    cartao(pres, s, 9.1, 10.33, 6.17, 1.55, 'Total Validadas pela INFRA', fmt(n.validadas), { hc: 0.53, sizeCab: 20, sizeVal: 32 });
    s.addText('=', { x: 7.66, y: 11.95, w: 1.44, h: 0.6, fontFace: FONTE, fontSize: 32, bold: true, color: VERDE, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    cartao(pres, s, 1.37, 12.73, 13.9, 1.55, 'Total Concluídas pela Vale', fmt(n.concluidas), { hc: 0.53, sizeCab: 20, sizeVal: 32 });
    s.addText('}', { x: 15.55, y: 10.6, w: 1.3, h: 3.0, fontFace: FONTE, fontSize: 150, color: VERDE, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    cartao(pres, s, 17.13, 11.33, 8.43, 1.55, 'Avanço das validadas vs concluídas', pctTxt(n.validadas, n.concluidas), { hc: 0.53, sizeCab: 20, sizeVal: 32 });
    if (n.outro) s.addNotes(`${n.outro} item concluído com outro conteúdo na coluna Validação INFRA (ex.: foto) não entra em "aguardando" nem em "validadas".`);
  }

  const COLW = [2.6, 1.4, 3.69, 2.12, 2.15], TW = COLW.reduce((a, b) => a + b, 0);
  const TY = 3.32, HDR = 1.18, AREA = H - 0.12 - TY - HDR, XS = [1.37, 13.67];
  function tabela(pres, s, x, itens, fotos, linhas) {
    const rows = itens.length; if (!rows) return;
    const rh = Math.min(1.15, AREA / (linhas || rows));     // mesma altura de linha nas duas tabelas do slide
    const fs = rh >= 0.95 ? 14 : rh >= 0.8 ? 11.5 : rh >= 0.7 ? 11 : 10;
    const borda = { type: 'solid', pt: 0.75, color: '7F7F7F' };
    const cab = ['KM', "ID's", 'DESCRIÇÃO', 'REGISTRO FOTOGRÁFICO (INFRA)', 'REGISTRO FOTOGRÁFICO (FICO)'].map(t => ({
      text: t, options: { fill: { color: VERDE }, color: 'FFFFFF', bold: true, fontSize: t.length > 10 ? 18 : 20, align: 'center', valign: 'middle', fontFace: FONTE, border: borda } }));
    const corpo = itens.map(i => [
      { text: i.km || '', options: { align: 'center' } },
      { text: (i.ids || '').replace(/ \/ /g, '/'), options: { align: 'center', fill: { color: 'EBF1DE' } } },
      { text: i.desc || '', options: { align: 'center' } },
      { text: '' }, { text: '' },
    ].map(c => ({ text: c.text, options: Object.assign({ fontFace: FONTE, fontSize: fs, color: TXT, valign: 'middle', border: borda, fill: { color: 'FFFFFF' }, margin: 0.04 }, c.options) })));
    s.addTable([cab, ...corpo], { x, y: TY, w: TW, colW: COLW, rowH: [HDR, ...Array(rows).fill(rh)], autoPage: false });
    const xp = [x + COLW[0] + COLW[1] + COLW[2], x + COLW[0] + COLW[1] + COLW[2] + COLW[3]];
    itens.forEach((it, r) => {
      const y = TY + HDR + r * rh;
      [['Pendencia', 0], ['Resolucao', 1]].forEach(([k, c]) => {
        const img = fotos.get(`${it.id}_${k}`.toUpperCase());
        if (img) s.addImage(Object.assign(caber(img, xp[c] + 0.08, y + 0.06, COLW[3 + c] - 0.16, rh - 0.12), { altText: `${it.id} – foto ${k === 'Pendencia' ? 'INFRA' : 'FICO'}` }));
      });
    });
  }
  function pacoteSlides(pres, logo, pac, itens, fotos) {
    const paginas = Math.max(1, Math.ceil(itens.length / 32));   // até 16 linhas por tabela, 2 tabelas por slide
    const porPag = Math.ceil(itens.length / paginas);
    for (let p = 0; p < paginas; p++) {
      const pg = itens.slice(p * porPag, (p + 1) * porPag);
      const s = pres.addSlide(); moldura(pres, s, null, 'Pendências encerradas pela VALE para validação da INFRA', undefined, true);
      const titulo = `${pac.pacote.toUpperCase()} (${(pac.trecho || '').trim()})` + (paginas > 1 ? `  –  ${p + 1}/${paginas}` : '');
      s.addText(titulo, { shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.18, x: 1.37, y: 1.56, w: 24.27, h: 1.35, fill: { color: VERDE }, line: { color: VERDE },
        fontFace: FONTE, fontSize: 28, color: 'FFFFFF', align: 'center', valign: 'middle' });
      if (!pg.length) {
        s.addText('Nenhuma pendência concluída aguardando validação da INFRA neste pacote.', { x: 1.37, y: 6, w: 24.27, h: 1.2, fontFace: FONTE, fontSize: 28, color: CINZA, align: 'center', isTextBox: true });
        continue;
      }
      const meio = Math.ceil(pg.length / 2);
      tabela(pres, s, XS[0], pg.slice(0, meio), fotos, meio);
      tabela(pres, s, XS[1], pg.slice(meio), fotos, meio);
    }
  }

  /* ---------- slides finais (conteúdo manual: estrutura pronta para preencher) ---------- */
  const COLW_M = [5.2, 2.8, 10, 5.9];
  function tabelaManual(pres, s, y, linhas, alturaMax, aprovacao) {
    const borda = { type: 'solid', pt: 0.75, color: '7F7F7F' };
    const cab = ['KM', 'Aprovação', 'DESCRIÇÃO', 'REGISTRO FOTOGRÁFICO'].map(t => ({ text: t, options: {
      fill: { color: VERDE }, color: 'FFFFFF', bold: true, fontSize: 18, align: 'center', valign: 'middle', fontFace: FONTE, border: borda } }));
    const rh = Math.min(linhas === 1 ? 4.38 : 1.11, alturaMax / linhas);
    const corpo = Array.from({ length: linhas }, () => [
      { text: '' },
      aprovacao ? { text: aprovacao, options: { color: 'FF0000', bold: true } } : { text: '' },
      { text: '' }, { text: '' },
    ].map(c => ({ text: c.text, options: Object.assign({ fontFace: FONTE, fontSize: 18, color: '000000', align: 'center', valign: 'middle', border: borda, fill: { color: 'FFFFFF' } }, c.options) })));
    s.addTable([cab, ...corpo], { x: 1.37, y, w: COLW_M.reduce((a, b) => a + b, 0), colW: COLW_M, rowH: [linhas === 1 ? 0.75 : 0.47, ...Array(linhas).fill(rh)], autoPage: false });
  }
  function naoConforme(pres, logo, qtd) {
    const linhas = Math.max(1, qtd || 1);
    for (let p = 0; p < Math.ceil(linhas / 10); p++) {
      const n = Math.min(10, linhas - p * 10);
      const s = pres.addSlide();
      const tit = qtd ? `Pendência${qtd > 1 ? 's' : ''} não conforme${qtd > 1 ? 's' : ''} – ${qtd} pendência${qtd > 1 ? 's' : ''}` : 'Pendência não conforme';
      moldura(pres, s, logo, tit);
      tabelaManual(pres, s, n === 1 ? 4.33 : 1.83, n, 11.07, 'Não conforme');
    }
  }
  function novasPendencias(pres, logo, qtd) {
    const linhas = Math.max(1, qtd || 5);
    const pags = Math.ceil(linhas / 10);
    for (let p = 0; p < pags; p++) {
      const n = Math.min(10, linhas - p * 10);
      const s = pres.addSlide();
      moldura(pres, s, logo, (qtd ? `Novas pendências – ${qtd} pendência${qtd > 1 ? 's' : ''} cadastrada${qtd > 1 ? 's' : ''}` : 'Novas pendências') + (pags > 1 ? ` (${p + 1}/${pags})` : ''));
      tabelaManual(pres, s, 1.83, n, 11.07, '');
    }
  }
  function retornos(pres, logo, dataReuniao) {
    const s = pres.addSlide(); moldura(pres, s, logo, null);
    const d = dataReuniao ? dataReuniao.toLocaleDateString('pt-BR') : '__/__/____';
    const tit = (t, y) => s.addText(t, { x: 1.51, y, w: 22.89, h: 0.88, fontFace: FONTE, fontSize: 46, bold: true, color: VERDE, margin: 0, valign: 'middle', isTextBox: true });
    const corpo = (y, h) => s.addText([{ text: ' ', options: { bullet: true } }], { x: 1.51, y, w: 22.89, h, fontFace: FONTE, fontSize: 30, color: '000000', valign: 'top', isTextBox: true });
    tit(`Retornos da reunião de ${d}`, 0.41); corpo(1.31, 2.4);
    tit('Pontos de atenção', 3.85); corpo(4.8, 7.6);
    tit('Próximos passos', 12.55); corpo(13.45, 1.2);
  }
  // próxima sexta-feira (hoje, se for sexta) = data da reunião; os retornos são da reunião anterior
  function proximaReuniao(base) { const d = new Date(base); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); return d; }
  window.reuniaoAnteriorPadrao = () => { const d = proximaReuniao(new Date()); d.setDate(d.getDate() - 7); return d; };

  /* ---------- principal ---------- */
  window.exportarPptInfra = async function ({ dados, arquivos, antigas, novas, naoConformes, dataRetornos, progresso = () => {}, saida = 'download' }) {
    if (typeof PptxGenJS === 'undefined') throw new Error('Biblioteca de PowerPoint não carregou (verifique a conexão).');
    const { fotos: fotosArq, modelo } = indexar(arquivos);
    const pendentes = dados.itens.filter(i => i.cat === 'pendente_validacao')
      .sort((a, b) => (a.pacote.localeCompare(b.pacote)) || ((a.kmIni ?? 1e9) - (b.kmIni ?? 1e9)) || a.id.localeCompare(b.id));

    // imagens: só as fotos dos itens que vão para o PPT, reduzidas para manter o arquivo leve
    const precisa = []; pendentes.forEach(i => ['Pendencia', 'Resolucao'].forEach(k => { const key = `${i.id}_${k}`.toUpperCase(); if (fotosArq.has(key)) precisa.push(key); }));
    const fotos = new Map(); let feitas = 0;
    for (const key of precisa) {
      try { fotos.set(key, await imagem(fotosArq.get(key), 900, 0.8)); } catch (e) { console.warn('Foto ignorada', key, e); }
      progresso(`Preparando fotos ${++feitas}/${precisa.length}…`);
    }
    const mod = {};
    for (const [k, nome] of [['capa', 'capa.jpg'], ['sumario', 'sumario.jpg'], ['fluxo', 'fluxo.jpg'], ['logo', 'logo-vale.png']]) {
      if (modelo.has(nome)) { try { mod[k] = await bruto(modelo.get(nome)); } catch (e) { console.warn('Imagem do modelo ignorada', nome, e); } }
    }

    progresso('Montando slides…');
    const pres = new PptxGenJS();
    pres.defineLayout({ name: 'FICO_INFRA', width: W, height: H }); pres.layout = 'FICO_INFRA';
    pres.title = 'Reunião INFRA – Pendências'; pres.author = 'FICO';
    const hoje = new Date();
    const pacotes = dados.pacotes.map(p => p.pacote);
    const cnt = (f) => dados.itens.filter(f).length;
    const n = {
      validadas: cnt(i => i.cat === 'validada'), aguardando: pendentes.length, outro: cnt(i => i.cat === 'outro'),
      porPacote: pacotes.map(p => ({ nome: p, validadas: cnt(i => i.pacote === p && i.cat === 'validada') })),
    };
    n.concluidas = n.validadas + n.aguardando;

    capa(pres, mod.capa, proximaReuniao(hoje));
    imagemCheia(pres, mod.sumario, 'Sumário', 'Sumário:', ['Fluxo de Pendências INFRA', 'Avanço e evolução das pendências', 'Estratificação das pendências concluídas por pacote', 'Pendência não conforme e novas pendências', 'Retornos, pontos de atenção e próximos passos'], mod.logo);
    imagemCheia(pres, mod.fluxo, 'Fluxo de Pendências INFRA', 'Fluxo de Pendências INFRA', ['(Imagem do fluxo não encontrada: selecione a pasta Consolidado, que contém "Modelo PPT")'], mod.logo);
    avanco(pres, mod.logo, n, antigas, novas);
    dados.pacotes.forEach(p => pacoteSlides(pres, mod.logo, p, pendentes.filter(i => i.pacote === p.pacote), fotos));
    naoConforme(pres, mod.logo, naoConformes);
    novasPendencias(pres, mod.logo, novas);
    retornos(pres, mod.logo, dataRetornos);

    const reuniao = proximaReuniao(hoje);
    const nome = `Reunião INFRA ${String(reuniao.getDate()).padStart(2, '0')}.${String(reuniao.getMonth() + 1).padStart(2, '0')}.pptx`;
    progresso('Gerando arquivo…');
    const resumo = { arquivo: nome, slides: pres.slides ? pres.slides.length : undefined, itens: pendentes.length, fotos: fotos.size, fotosFaltando: precisa.length - fotos.size,
      semFoto: pendentes.filter(i => !fotos.has(`${i.id}_PENDENCIA`) && !fotos.has(`${i.id}_RESOLUCAO`)).map(i => i.id), modelo: Object.keys(mod) };
    if (saida === 'base64') return Object.assign(resumo, { base64: await pres.write({ outputType: 'base64' }) });
    await pres.writeFile({ fileName: nome });
    return resumo;
  };
})();
