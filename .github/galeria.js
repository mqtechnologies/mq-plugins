// Galeria comunitária do MQ Creator (corre no GitHub Actions).
// Cada pedido (issue) com a etiqueta «galeria» é uma entrada: o formulário dá os dados, os ficheiros anexados
// vão para uma «release» (o GitHub conta as descargas) e uma cópia fica em galeria/f/<n>/ (para a app descarregar).
// - pedido aberto/editado pelo autor com ficheiros novos → nova versão;  - pedido fechado → retirado da galeria;
// - de 6 em 6 horas (e em cada evento) atualiza descargas, 👍 e comentários.
// uso: node .github/galeria.js            (lê GITHUB_EVENT_PATH / GITHUB_EVENT_NAME)
//      node .github/galeria.js --test     (testes locais do leitor do formulário e do zip, sem rede)
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), G = path.join(ROOT, 'galeria'), CAT = path.join(G, 'catalog.json');
const REPO = process.env.GITHUB_REPOSITORY || 'sergi-bermudez/mq-plugins', TOKEN = process.env.GITHUB_TOKEN || '';
const API = 'https://api.github.com/repos/' + REPO;
const MAXF = 100 * 1024 * 1024;
const TIPOS = { 'Atividade': 'app', 'Modelo editável': 'tpl', 'MQ Server': 'srv', 'Plugin': 'plugin' };

/* ---------- formulário ---------- */
function parseForm(body) {
  const out = {}, re = /^###\s+(.+?)\s*$/gm; const heads = []; let m;
  while ((m = re.exec(body || ''))) heads.push({ k: m[1].trim(), i: m.index, e: re.lastIndex });
  heads.forEach((h, j) => { let v = (body.slice(h.e, j + 1 < heads.length ? heads[j + 1].i : undefined) || '').trim(); if (v === '_No response_' || v === 'None') v = ''; out[h.k] = v; });
  const list = (v) => String(v || '').split(/,\s*/).map((x) => x.trim()).filter(Boolean);
  return {
    tipo: TIPOS[(out['Tipo'] || '').trim()] || 'app',
    areas: list(out['Áreas']), etiquetas: list(out['Etiquetas']).map((x) => x.toLowerCase()).slice(0, 12),
    descricao: (out['Descrição'] || '').slice(0, 2000), linguas: list(out['Língua']), idade: list(out['Idade']),
    licenca: (out['Licença'] || '').trim(), servidor: (out['Endereço do MQ Server'] || '').trim(),
    ficheiros: anexos(out['Ficheiros'] || '')
  };
}
/* só ficheiros anexados ao GitHub (ou já neste repositório): nunca endereços quaisquer */
const OKURL = /^https:\/\/(github\.com\/user-attachments\/(files|assets)\/|user-images\.githubusercontent\.com\/|private-user-images\.githubusercontent\.com\/|raw\.githubusercontent\.com\/sergi-bermudez\/mq-plugins\/)/;
function anexos(txt) {
  const r = [], seen = new Set();
  const add = (url, name) => { url = url.replace(/[)>\]"']+$/, ''); if (!OKURL.test(url) || seen.has(url)) return; seen.add(url); r.push({ url, name: (name || url.split('/').pop() || 'ficheiro').replace(/[^\w.\-]+/g, '_').slice(0, 80) }); };
  for (const m of txt.matchAll(/\[([^\]]*)\]\((https:[^)\s]+)\)/g)) add(m[2], m[1]);
  for (const m of txt.matchAll(/src="(https:[^"]+)"/g)) add(m[1], '');
  for (const m of txt.matchAll(/(^|\s)(https:\/\/\S+)/g)) add(m[2], '');
  return r.slice(0, 6);
}

/* ---------- que ficheiro é ---------- */
function zipNames(b) {
  let e = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) return null; const n = b.readUInt16LE(e + 10); let p = b.readUInt32LE(e + 16); const names = [];
  for (let k = 0; k < n && p + 46 <= b.length; k++) { if (b.readUInt32LE(p) !== 0x02014b50) break; const fl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32); names.push(b.slice(p + 46, p + 46 + fl).toString('utf8')); p += 46 + fl + xl + cl; }
  return names;
}
function kindOf(b, name) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e) return { k: 'img', ext: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8) return { k: 'img', ext: 'jpg' };
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return { k: 'img', ext: 'webp' };
  if (b[0] === 0x50 && b[1] === 0x4b) {
    const ns = zipNames(b) || [];
    if (ns.some((x) => /^MqActivities\/.+\.mq$/i.test(x) || /\.mq$/i.test(x))) return { k: 'mqx', ext: 'mqx' };
    if (ns.some((x) => /(^|\/)plugin\.json$/.test(x))) return { k: 'plugin', ext: 'zip' };
    if (ns.some((x) => /(^|\/)index\.html?$/i.test(x))) return { k: 'build', ext: 'zip' };
    return { k: 'zip', ext: 'zip' };
  }
  const head = b.slice(0, 2048).toString('utf8').toLowerCase();
  if (/<!doctype html|<html/.test(head) || /\.html?$/i.test(name)) return { k: 'build', ext: 'html' };
  return { k: '?', ext: 'bin' };
}

/* ---------- GitHub ---------- */
async function gh(p, o = {}) {
  const r = await fetch(p.startsWith('http') ? p : API + p, Object.assign({}, o, { headers: Object.assign({ Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'mq-galeria' }, o.headers || {}) }));
  if (r.status === 204) return null; const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = t; }
  if (!r.ok) throw new Error(`${o.method || 'GET'} ${p}: ${r.status} ${String(t).slice(0, 200)}`); return j;
}
async function ghAll(p) { const out = []; for (let pg = 1; pg < 20; pg++) { const l = await gh(p + (p.includes('?') ? '&' : '?') + 'per_page=100&page=' + pg); out.push(...l); if (l.length < 100) break; } return out; }
const comment = (n, body) => gh(`/issues/${n}/comments`, { method: 'POST', body: JSON.stringify({ body }) }).catch((e) => console.log('comentário:', e.message));
async function labels(n, add) { try { await gh(`/issues/${n}/labels`, { method: 'POST', body: JSON.stringify({ labels: add }) }); } catch (e) { console.log('etiquetas:', e.message); } }
async function download(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'mq-galeria' }, redirect: 'follow' });
  if (!r.ok) throw new Error('não consegui descarregar ' + url.split('/').pop() + ' (' + r.status + ')');
  const len = +r.headers.get('content-length') || 0; if (len > MAXF) throw new Error('ficheiro grande demais');
  const b = Buffer.from(await r.arrayBuffer()); if (b.length > MAXF) throw new Error('ficheiro grande demais'); return b;
}

/* ---------- catálogo ---------- */
const load = () => { try { return JSON.parse(fs.readFileSync(CAT, 'utf8')); } catch (e) { return { v: 1, apps: [] }; } };
function save(c) { c.updated = new Date().toISOString(); c.apps.sort((a, b) => (b.score || 0) - (a.score || 0) || String(b.updated).localeCompare(String(a.updated))); fs.mkdirSync(G, { recursive: true }); fs.writeFileSync(CAT, JSON.stringify(c, null, 1)); }
const score = (a) => Math.round(((a.downloads || 0) + 5 * (a.likes || 0) + 2 * (a.comments || 0)) * (a.editable ? 1.5 : 1) * 10) / 10;
function rmFiles(n) { fs.rmSync(path.join(G, 'f', String(n)), { recursive: true, force: true }); }

async function publish(issue, sender, c) {
  const n = issue.number, f = parseForm(issue.body || ''); let e = c.apps.find((x) => x.id === n);
  const isAuthor = sender && (sender === issue.user.login || sender === REPO.split('/')[0]);
  const meta = { id: n, title: String(issue.title || '').replace(/^\s*\[[^\]]*\]\s*/, '').slice(0, 90) || 'Sem nome', tipo: f.tipo, areas: f.areas, etiquetas: f.etiquetas, descricao: f.descricao,
    linguas: f.linguas, idade: f.idade, licenca: f.licenca, autor: { login: issue.user.login, avatar: issue.user.avatar_url, url: issue.user.html_url }, url: issue.html_url };
  const errs = [];
  if (f.tipo === 'srv') {
    if (!/^https:\/\/[^\s]+$/.test(f.servidor)) errs.push('Falta o endereço do MQ Server (https://…).');
    else { try { const u = f.servidor.replace(/\/?$/, '/'); const j = await (await fetch(u + 'mqserver.json')).json(); if (!j || !/^mq-(server|hub)$/.test(j.kind)) throw 0; meta.servidor = u; meta.n = j.n || (j.servers || []).length || 0; } catch (x) { errs.push('Não encontrei um MQ Server em ' + f.servidor + ' (falta mqserver.json).'); } }
  }
  const prevSrc = e && e.versions.length ? e.versions[e.versions.length - 1].src.join(' ') : '';
  const srcNow = f.ficheiros.map((x) => x.url);
  let newVersion = null;
  if (f.tipo !== 'srv' && srcNow.length && srcNow.join(' ') !== prevSrc && isAuthor) {
    const files = [];
    for (const a of f.ficheiros) { try { const b = await download(a.url); files.push(Object.assign({ b, name: a.name }, kindOf(b, a.name))); } catch (x) { errs.push(x.message); } }
    const mqx = files.find((x) => x.k === 'mqx'), build = files.find((x) => x.k === 'build'), plug = files.find((x) => x.k === 'plugin'), img = files.find((x) => x.k === 'img');
    if (f.tipo === 'tpl' && !mqx) errs.push('Um modelo editável precisa do ficheiro .mqx.');
    if (f.tipo === 'app' && !mqx && !build) errs.push('Falta a app: o .mqx (editável) ou a build (.html / .zip).');
    if (f.tipo === 'plugin' && !plug) errs.push('Falta o plugin: um .zip com plugin.json.');
    if (!errs.length) newVersion = { mqx, build, plug, img, src: srcNow };
  }
  if (errs.length) { await comment(n, '⚠️ **Não publiquei** esta versão:\n\n' + errs.map((x) => '- ' + x).join('\n') + '\n\nCorrija editando o pedido (os ficheiros vão na caixa «Ficheiros»).'); if (!e) return c; }
  if (!e && !newVersion && f.tipo !== 'srv') { if (!srcNow.length) await comment(n, '⚠️ Ainda não há ficheiros. Edite o pedido e arraste o .mqx, a build ou o plugin para a caixa «Ficheiros».'); return c; }
  if (!e) { e = Object.assign({ versions: [], downloads: 0, likes: 0, comments: 0, created: new Date().toISOString() }, meta); c.apps.push(e); }
  Object.assign(e, meta, { updated: new Date().toISOString() });
  if (newVersion) {
    const k = e.versions.length + 1, tag = `g${n}-v${k}`, dir = path.join(G, 'f', String(n), 'v' + k); fs.mkdirSync(dir, { recursive: true });
    const rel = await gh('/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, target_commitish: 'main', name: `${e.title} · v${k}`, body: `Galeria comunitária · ${e.url}\nAutor: @${e.autor.login} · Licença: ${e.licenca || '—'}`, prerelease: false, make_latest: 'false' }) });
    const v = { v: k, tag, date: new Date().toISOString(), src: newVersion.src, files: {} };
    const slug = (e.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'app');
    for (const [role, x] of [['mqx', newVersion.mqx], ['build', newVersion.build], ['plugin', newVersion.plug], ['img', newVersion.img]]) {
      if (!x) continue; const fname = role === 'img' ? `capa.${x.ext}` : `${slug}${role === 'build' ? '-build' : ''}.${x.ext}`;
      const up = await gh(`https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(fname)}`, { method: 'POST', body: x.b, headers: { 'Content-Type': 'application/octet-stream' } });
      const copy = path.join(dir, fname + (role === 'img' ? '' : '.bin')); fs.writeFileSync(copy, x.b);
      v.files[role] = { name: fname, size: x.b.length, asset: up.id, url: up.browser_download_url, copy: path.relative(ROOT, copy).split(path.sep).join('/') };
    }
    if (v.files.img) e.thumb = v.files.img.copy;
    e.editable = !!v.files.mqx || (e.tipo === 'tpl'); e.versions.push(v);
    await labels(n, ['galeria', 'publicada']);
    await comment(n, `✅ **Publicada** na galeria comunitária (versão ${k}).\n\n${v.files.mqx ? '✏️ Editável (.mqx)' : '▶️ Só para jogar (sem .mqx)'} · ficheiros: ${Object.values(v.files).map((x) => x.name).join(', ')}\n\nPara uma nova versão, edite o pedido e junte os ficheiros novos. Para retirar, feche o pedido.`);
  } else if (f.tipo === 'srv' && !e.versions.length) { e.versions.push({ v: 1, date: new Date().toISOString(), src: [], files: {} }); await labels(n, ['galeria', 'publicada']); await comment(n, '✅ **MQ Server publicado** na galeria comunitária: ' + e.servidor); }
  return c;
}
async function retire(issue, c) {
  const n = issue.number, e = c.apps.find((x) => x.id === n); if (!e) return c;
  for (const v of e.versions) if (v.tag) { try { const r = await gh('/releases/tags/' + v.tag); await gh('/releases/' + r.id, { method: 'DELETE' }); await gh('/git/refs/tags/' + v.tag, { method: 'DELETE' }); } catch (x) { console.log(x.message); } }
  rmFiles(n); c.apps = c.apps.filter((x) => x.id !== n); await comment(n, '🗑️ Retirada da galeria comunitária (o pedido foi fechado). Para voltar a publicar, reabra-o.'); return c;
}
/* descargas (das releases), 👍 e comentários de cada entrada */
async function counts(c) {
  let rels = []; try { rels = await ghAll('/releases'); } catch (x) { console.log(x.message); }
  for (const e of c.apps) {
    let d = 0; for (const r of rels) if (r.tag_name.startsWith(`g${e.id}-v`)) for (const a of r.assets || []) d += a.download_count || 0;
    e.downloads = d;
    try { const i = await gh('/issues/' + e.id); e.likes = (i.reactions && i.reactions['+1']) || 0; e.comments = i.comments || 0; if (i.state === 'closed') e._closed = true; } catch (x) { console.log(x.message); }
    e.score = score(e);
  }
  c.apps = c.apps.filter((x) => !x._closed); return c;
}

async function main() {
  if (process.argv.includes('--test')) return test();
  const ev = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const name = process.env.GITHUB_EVENT_NAME || '';
  let c = load();
  const issue = ev.issue, isG = issue && (issue.labels || []).some((l) => (l.name || l) === 'galeria') && !issue.pull_request;
  if (isG && name === 'issues') {
    if (ev.action === 'closed') c = await retire(issue, c);
    else if (['opened', 'edited', 'reopened', 'labeled'].includes(ev.action)) c = await publish(issue, ev.sender && ev.sender.login, c);
  }
  c = await counts(c);
  save(c);
}

function test() {
  const body = "### Tipo\n\nAtividade\n\n### Áreas\n\nCognitivo, Infantil\n\n### Etiquetas\n\nMemória, atenção\n\n### Descrição\n\nUm jogo.\n\n### Língua\n\nPortuguês\n\n### Idade\n\n_No response_\n\n### Licença\n\nCC BY 4.0\n\n### Endereço do MQ Server\n\n_No response_\n\n### Ficheiros\n\n[jogo.mqx](https://github.com/user-attachments/files/123/jogo.mqx)\n<img width=\"512\" alt=\"capa\" src=\"https://github.com/user-attachments/assets/ab-cd\" />\nhttps://evil.example.com/x.mqx\n\n### Direitos\n\n- [X] Fiz este conteúdo";
  const f = parseForm(body); console.log(JSON.stringify(f));
  if (f.tipo !== 'app' || f.areas.length !== 2 || f.ficheiros.length !== 2 || f.idade.length) throw new Error('parseForm');
  const mqx = fs.readdirSync(ROOT).length; console.log('ok', mqx);
}
main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { parseForm, kindOf, zipNames };
