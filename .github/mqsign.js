// Assina os índices das atualizações da interface do MQ Creator (corre no GitHub Actions).
// uso: node .github/mqsign.js test            → cada updates/<ed>/pending.json novo passa a test.json + test.sig
//      node .github/mqsign.js stable <ed|all>  → o test.json atual passa a stable.json (o estável anterior fica em stable-prev.json)
//      node .github/mqsign.js rollback <ed|all> → volta ao estável anterior (força as instalações a voltarem a ele)
// A chave privada vem do segredo MQ_SIGN_KEY (base64, 64 bytes). updates/policy.json pode ter:
//   keys: [chaves públicas aceites a partir daqui] (troca de chave) · revoked: [ids de códigos de testes anulados]
const fs = require('fs'), path = require('path');
const nacl = require('./nacl-fast.min.js');
const U = path.join(__dirname, '..', 'updates');
const [mode, which = 'all'] = process.argv.slice(2);
const sk = Buffer.from(process.env.MQ_SIGN_KEY || '', 'base64');
if (sk.length !== 64) { console.error('MQ_SIGN_KEY em falta ou inválida (64 bytes em base64)'); process.exit(1); }
const pol = fs.existsSync(path.join(U, 'policy.json')) ? JSON.parse(fs.readFileSync(path.join(U, 'policy.json'), 'utf8')) : {};
const rd = (ed, f) => { const p = path.join(U, ed, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const hex = u => Buffer.from(u).toString('hex');
let seq = Date.now();
function sign(ed, base, channel, extra) {
  for (const p of base.parts) {
    const fp = path.join(U, ed, 'p', p.f);
    if (!fs.existsSync(fp)) throw new Error(ed + ': falta a parte ' + p.f);
    const b = fs.readFileSync(fp);
    if (hex(nacl.hash(b)).slice(0, 64) + '.bin' !== p.f || b.length !== p.n) throw new Error(ed + ': parte corrompida ' + p.f);
  }
  const o = { v: 1, ed, version: base.version, minExe: base.minExe, built: base.built, parts: base.parts, channel, seq: seq++, signed: new Date().toISOString(), ...extra };
  if (Array.isArray(pol.keys) && pol.keys.length) o.keys = pol.keys;
  if (Array.isArray(pol.revoked) && pol.revoked.length) o.revoked = pol.revoked;
  const text = JSON.stringify(o);
  const sig = Buffer.from(nacl.sign.detached(Buffer.from(text, 'utf8'), sk)).toString('base64');
  fs.writeFileSync(path.join(U, ed, channel + '.json'), text);
  fs.writeFileSync(path.join(U, ed, channel + '.sig'), sig + '\n');
  console.log(ed, channel, o.version, 'seq', o.seq, extra && extra.force ? '(forçado)' : '');
}
function cleanup(ed) {
  const keep = new Set();
  for (const f of ['pending.json', 'test.json', 'stable.json', 'stable-prev.json']) { const o = rd(ed, f); if (o) o.parts.forEach(p => keep.add(p.f)); }
  const pd = path.join(U, ed, 'p'); if (!fs.existsSync(pd)) return;
  for (const f of fs.readdirSync(pd)) if (!keep.has(f)) { fs.unlinkSync(path.join(pd, f)); console.log(ed, 'apagada', f); }
}
const eds = fs.readdirSync(U).filter(d => fs.existsSync(path.join(U, d, 'pending.json')) && (which === 'all' || which === d));
for (const ed of eds) {
  if (mode === 'test') {
    const pen = rd(ed, 'pending.json'), t = rd(ed, 'test.json');
    if (t && t.built === pen.built && t.version === pen.version) { console.log(ed, 'sem alterações'); continue; }
    sign(ed, pen, 'test');
  } else if (mode === 'stable') {
    const t = rd(ed, 'test.json'), s = rd(ed, 'stable.json');
    if (!t) { console.log(ed, 'sem versão de testes'); continue; }
    if (s && s.version === t.version && s.built === t.built) { console.log(ed, 'já é a estável'); continue; }
    if (s) fs.writeFileSync(path.join(U, ed, 'stable-prev.json'), JSON.stringify(s));
    sign(ed, t, 'stable');
  } else if (mode === 'rollback') {
    const pv = rd(ed, 'stable-prev.json');
    if (!pv) { console.log(ed, 'não há estável anterior'); continue; }
    sign(ed, pv, 'stable', { force: true });
  } else { console.error('modo desconhecido', mode); process.exit(1); }
  cleanup(ed);
}
