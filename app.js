/* MindNest — app (paparan sahaja; data dalam Google Sheet melalui Apps Script) */
'use strict';

const API = 'https://script.google.com/macros/s/AKfycbyU7eK5XdQH2nbLx8iznmeQOTL-RU-QHpnB7uoZdVxtIORG5mN3CaA7Cq41LuBd1DHs/exec';
const AREAS = ['MSM', 'Kopi Lata', 'Staf', 'Marketing', 'Sistem', 'Peribadi'];
const BILA = ['Hari ini', 'Esok', 'Minggu ni', 'Satu hari nanti'];
const RASA = ['Tenang', 'Penat', 'Risau', 'Puas'];
const INGAT_SELANG = [3, 7, 21, 60]; // hari: ulangan berjarak

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('mn_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('mn_' + k, JSON.stringify(v)); } catch (e) {} }
};

/* ---------- kunci ---------- */
(function ambilKunci() {
  const m = location.hash.match(/k=([^&]+)/);
  if (m) { store.set('k', decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname); }
})();
const KUNCI = store.get('k', '');

/* ---------- keadaan ---------- */
let D = store.get('data', { today: hariIni(), notes: [], projects: [], areas: AREAS, fokus: null });
let skrin = null, cabang = null, rasaPilih = '', bilaPilih = '', areaPilih = '';
let modSiang = false; // pengguna tukar dari mod malam

function hariIni(off) {
  const d = new Date(); d.setDate(d.getDate() + (off || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function jam() { return new Date().getHours(); }
function waktuMalam() { const h = jam(); return h >= 21 || h < 5; }
function masaKini() { return hariIni() + ' ' + String(new Date().getHours()).padStart(2, '0') + ':' + String(new Date().getMinutes()).padStart(2, '0'); }

/* ---------- NESTY: PA yang sentiasa ada ----------
   mood: senyum | dengar | gembira | raikan | risau | fikir | tidur
   Nesty bercakap bila sesuatu berlaku: buka app, tukar skrin, simpan, siap, data berubah, internet putus/sambung. */
const NESTY_MOOD = ['senyum', 'dengar', 'gembira', 'raikan', 'risau', 'fikir', 'tidur'];
let nestyTerakhir = { teks: '', masa: 0 };
function nesty(teks, mood, ms) {
  const el = $('nesty'); if (!el || el.hidden) return;
  mood = mood || (waktuMalam() ? 'tidur' : 'senyum');
  NESTY_MOOD.forEach(m => el.classList.remove(m));
  void el.offsetWidth; // mula semula animasi
  el.classList.add(mood);
  if (navigator.vibrate && (mood === 'raikan')) navigator.vibrate(30);
  const b = $('nesty-buih');
  if (teks) {
    nestyTerakhir = { teks, masa: Date.now() };
    b.innerHTML = teks; b.classList.add('on');
    clearTimeout(nesty._t);
    nesty._t = setTimeout(() => b.classList.remove('on'), ms || Math.max(3200, teks.length * 55));
  }
  clearTimeout(nesty._m);
  if (mood !== 'dengar' && mood !== 'fikir') nesty._m = setTimeout(() => { NESTY_MOOD.forEach(m => el.classList.remove(m)); el.classList.add(waktuMalam() ? 'tidur' : 'senyum'); }, 2400);
}
function nestyDiam() { clearTimeout(nesty._m); const el = $('nesty'); NESTY_MOOD.forEach(m => el.classList.remove(m)); el.classList.add(waktuMalam() ? 'tidur' : 'senyum'); }
function toast(m, ms) { nesty(esc(m), null, ms); }

function ringkasanNesty() {
  const s = senaraiSekarang();
  const lewat = s.filter(x => x.lewat).length;
  const baru = D.notes.filter(n => n.status === 'Baru').length;
  const tanpaCabang = D.notes.filter(n => aktif(n) && !n.area).length;
  const bahagian = [];
  bahagian.push(s.length ? '<b>' + s.length + '</b> perkara untuk hari ini' : 'Tiada yang mendesak hari ini');
  if (lewat) bahagian.push('<b>' + lewat + '</b> dah lewat');
  if (baru) bahagian.push(baru + ' fikiran baru menunggu Claude susun');
  if (tanpaCabang) bahagian.push(tanpaCabang + ' belum ada cabang');
  return bahagian.join(', ') + '.';
}
function sapaan() {
  const h = jam();
  if (h >= 5 && h < 12) return 'Selamat pagi, Tuan.';
  if (h >= 12 && h < 15) return 'Selamat tengah hari, Tuan.';
  if (h >= 15 && h < 19) return 'Selamat petang, Tuan.';
  return 'Selamat malam, Tuan.';
}
const KATA_SKRIN = {
  lepas: () => 'Campak apa saja. Saya simpan, Claude susun.',
  malam: () => 'Dah malam. Tulis apa perlu esok, lepas tu kita rehat.',
  peta: () => { const t = D.notes.filter(n => aktif(n) && !n.area).length; return t ? t + ' fikiran belum ada cabang. Tolong saya letakkan?' : 'Ketik satu cabang, saya buka.'; },
  sekarang: () => { const s = senaraiSekarang(); if (!s.length) return 'Kosong! Tuan boleh rehat.'; return s[0].lewat ? 'Yang ini dah lewat. Satu langkah kecil pun cukup.' : 'Satu je dulu. Yang lain saya sorokkan.'; }
};
let skrinDisapa = {};

/* ---------- rangkaian + barisan offline ---------- */
async function muat() {
  if (!KUNCI) return;
  try {
    const r = await fetch(API + '?k=' + encodeURIComponent(KUNCI), { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) { $('sync').textContent = j.error === 'Kunci tidak sah' ? 'Kunci tidak sah' : 'Ralat data'; return; }
    const lama = D; D = j.data; store.set('data', D); $('sync').textContent = '';
    beritaPerubahan(lama, D);
    lukis();
  } catch (e) { $('sync').textContent = 'Luar talian'; }
}

function beritaPerubahan(lama, baru) {
  if (!lama || !lama.notes) return;
  const t = hariIni();
  if (baru.fokus && baru.fokus.tarikh === t && (!lama.fokus || lama.fokus.tarikh !== t)) {
    nesty('Fokus pagi dari Claude dah sampai: <b>' + baru.fokus.items.length + '</b> perkara. Saya tunjuk satu demi satu di Sekarang.', 'gembira', 6000); return;
  }
  const disusun = baru.notes.filter(n => n.status === 'Disusun').length - lama.notes.filter(n => n.status === 'Disusun').length;
  if (disusun > 0) { nesty('Claude baru susun <b>' + disusun + '</b> fikiran Tuan.', 'gembira'); return; }
  const lamaP = {}; (lama.projects || []).forEach(p => (lamaP[p.id] = p));
  const tukar = baru.projects.filter(p => lamaP[p.id] && (lamaP[p.id].status !== p.status || lamaP[p.id].langkah !== p.langkah));
  if (tukar.length) nesty('Projek <b>' + esc(tukar[0].nama) + '</b> ada perubahan' + (tukar.length > 1 ? ' (dan ' + (tukar.length - 1) + ' lagi)' : '') + '.', 'fikir', 4500);
}

function hantar(body) {
  const q = store.get('q', []); q.push(Object.assign({ k: KUNCI }, body)); store.set('q', q);
  return siram();
}
let menyiram = false;
async function siram() {
  if (menyiram || !navigator.onLine) {
    if (!navigator.onLine) { $('sync').textContent = 'Luar talian · disimpan dalam phone'; if (store.get('q', []).length) nesty('Tiada internet. Saya simpan dalam phone dulu, nanti saya hantar.', 'risau'); }
    return;
  }
  menyiram = true;
  try {
    let q = store.get('q', []);
    const adaTertunggak = q.length > 1 && siram._gagal;
    while (q.length) {
      const item = q[0];
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(item) });
      const j = await r.json();
      if (!j.ok && !/tidak dijumpai|tidak sah|Teks kosong/.test(j.error || '')) throw new Error(j.error); // ralat kekal: buang dari barisan
      q.shift(); store.set('q', q);
    }
    $('sync').textContent = '';
    if (adaTertunggak) nesty('Internet dah ada. Semua yang tertunggak saya dah hantar ke Sheet.', 'gembira');
    siram._gagal = false;
  } catch (e) {
    $('sync').textContent = 'Belum dihantar · cuba lagi nanti';
    if (!siram._gagal) nesty('Belum dapat hantar ke Sheet. Saya cuba lagi sendiri nanti.', 'risau');
    siram._gagal = true;
  } finally { menyiram = false; }
}
window.addEventListener('online', () => { siram._gagal = true; siram().then(muat); });
window.addEventListener('offline', () => { nesty('Internet terputus. Tak apa, saya pegang dulu.', 'risau'); });

/* ---------- teka area & bila (tanpa AI, serta-merta) ---------- */
const KATA = {
  'MSM': ['chalet', 'msm', 'tempahan', 'bilik', 'tetamu', 'booking', 'check-in', 'checkin', 'bbq', 'retreat', 'pakej', 'dewan', 'deposit'],
  'Kopi Lata': ['kopi', 'kabin', 'lata', 'menu', 'kek', 'matcha', 'cawan', 'loyverse', 'pos', 'barista', 'susu', 'premix', 'ais'],
  'Staf': ['staf', 'staff', 'anis', 'lina', 'amir', 'aina', 'alif', 'mira', 'latih', 'gaji', 'sop', 'shift'],
  'Marketing': ['post', 'facebook', 'fb', 'instagram', 'ig', 'tiktok', 'promo', 'iklan', 'kempen', 'review', 'logo', 'caption', 'video', 'brand'],
  'Sistem': ['app', 'sistem', 'github', 'script', 'sheet', 'website', 'notion', 'claude', 'mindnest', 'backup', 'harddisk', 'drive'],
  'Peribadi': ['rumah', 'keluarga', 'anak', 'isteri', 'thesis', 'tesis', 'peribadi', 'gym', 'doktor', 'umi', 'abah']
};
function tekaArea(t) {
  const s = ' ' + t.toLowerCase() + ' ';
  let best = '', n = 0;
  for (const a of AREAS) {
    const c = KATA[a].filter(w => s.includes(w)).length;
    if (c > n) { best = a; n = c; }
  }
  return best;
}
function tekaBila(t) {
  const s = t.toLowerCase();
  if (/\besok\b/.test(s)) return 'Esok';
  if (/hari ni|hari ini|sekarang|petang ni|malam ni|pagi ni/.test(s)) return 'Hari ini';
  if (/idea|satu hari|suatu hari|nanti/.test(s)) return 'Satu hari nanti';
  return 'Minggu ni';
}

/* ---------- suara ---------- */
function dengar(sasaran, butang, label) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { sasaran.focus(); toast('Guna butang mic pada keyboard phone'); return; }
  const r = new SR(); r.lang = 'ms-MY'; r.interimResults = true; r.continuous = false;
  const asal = sasaran.value ? sasaran.value.trimEnd() + (sasaran.id === 'esok' ? '\n' : ' ') : '';
  r.onstart = () => { butang.classList.add('dengar'); if (label) label.textContent = 'Sedang dengar…'; nesty('Cakaplah, saya dengar…', 'dengar', 2500); };
  r.onresult = e => {
    let txt = ''; for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
    sasaran.value = asal + txt; sasaran.dispatchEvent(new Event('input'));
  };
  r.onerror = () => toast('Tak dapat dengar. Cuba lagi atau taip.');
  r.onend = () => { butang.classList.remove('dengar'); if (label) label.textContent = 'Tekan dan cakap'; nestyDiam(); };
  r.start();
}

/* ---------- navigasi ---------- */
function pergi(s) {
  if (s === 'lepas' && waktuMalam() && !modSiang) s = 'malam';
  skrin = s;
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('on', el.id === 's-' + s));
  document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-current', (b.dataset.s === s || (s === 'malam' && b.dataset.s === 'lepas')) ? 'page' : 'false'));
  lukis(); window.scrollTo(0, 0);
  if (KATA_SKRIN[s] && Date.now() - (skrinDisapa[s] || 0) > 90000) {
    skrinDisapa[s] = Date.now();
    const sek = s === 'sekarang' && senaraiSekarang()[0];
    setTimeout(() => nesty(KATA_SKRIN[s](), s === 'malam' ? 'tidur' : (sek && sek.lewat ? 'risau' : 'senyum')), 250);
  }
}
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => { cabang = null; pergi(b.dataset.s); }));

function lukis() {
  document.body.classList.toggle('malam', waktuMalam());
  const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.content = waktuMalam() ? '#17121F' : '#5B1BC4';
  if (skrin !== 'sekarang' && $('lapis').style.display !== 'flex') $('nesty').classList.remove('di-dalam');
  if (skrin === 'lepas') lukisLepas();
  if (skrin === 'peta') lukisPeta();
  if (skrin === 'sekarang') lukisSekarang();
  if (skrin === 'malam') lukisMalam();
}

/* ---------- LEPASKAN ---------- */
$('mic').addEventListener('click', () => dengar($('teks'), $('mic'), $('mic-label')));
$('taip').addEventListener('click', () => $('teks').focus());
$('teks').addEventListener('input', () => {
  const t = $('teks').value.trim();
  $('lepas-langkah2').hidden = !t;
  if (t) {
    bilaPilih = ''; areaPilih = tekaArea(t); lukisLepas();
    clearTimeout(lukisLepas._n);
    lukisLepas._n = setTimeout(() => nesty('Saya rasa <b>' + tekaBila(t).toLowerCase() + '</b>' + (areaPilih ? ', cabang <b>' + esc(areaPilih) + '</b>' : '') + '. Tuan pilih.', 'fikir', 4200), 900);
  } else nestyDiam();
});

function lukisLepas() {
  const t = $('teks').value.trim();
  if (!t) return;
  const cadang = tekaBila(t);
  $('bila').innerHTML = BILA.map(b =>
    '<button type="button" class="pilih' + (b === cadang ? ' cadang' : '') + '" data-b="' + esc(b) + '">' + esc(b) +
    (b === cadang ? '<small>dicadangkan</small>' : '') + '</button>').join('');
  $('bila').querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => lepaskan(btn.dataset.b)));
  $('area-line').innerHTML = areaPilih
    ? 'Diletak di cabang <b>' + esc(areaPilih) + '</b>. <button type="button" class="linkbtn" id="tukar-area">Tukar</button>'
    : 'Belum ada cabang. <button type="button" class="linkbtn" id="tukar-area">Pilih cabang</button> atau biar Claude susun esok pagi.';
  $('tukar-area').addEventListener('click', () => {
    const c = $('area-chips'); c.hidden = !c.hidden;
    c.innerHTML = AREAS.map(a => '<button type="button" class="chip' + (a === areaPilih ? ' on' : '') + '" data-a="' + esc(a) + '">' + esc(a) + '</button>').join('');
    c.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { areaPilih = b.dataset.a; c.hidden = true; lukisLepas(); nesty('Okay, cabang <b>' + esc(areaPilih) + '</b>.', 'gembira', 2200); }));
  });
}

function lepaskan(bila) {
  const teks = $('teks').value.trim();
  if (!teks) return;
  const masa = masaKini();
  D.notes.unshift({ id: 'baru-' + Date.now(), masa, teks, jenis: '', area: areaPilih, projek: '', tarikh: '', status: 'Baru', catatan: '', bila });
  store.set('data', D);
  hantar({ action: 'addNote', teks, bila, area: areaPilih, masa }).then(muat);
  $('teks').value = ''; $('lepas-langkah2').hidden = true; $('area-chips').hidden = true;
  clearTimeout(lukisLepas._n);
  nesty(bila === 'Satu hari nanti' ? 'Saya simpan untuk satu hari nanti. Kepala boleh lupakan dulu.' : 'Saya simpan untuk <b>' + bila.toLowerCase() + '</b>. Kepala boleh rehat.', 'gembira');
}

/* ---------- MALAM ---------- */
$('mic-malam').addEventListener('click', () => dengar($('esok'), $('mic-malam')));
$('ke-siang').addEventListener('click', () => { modSiang = true; pergi('lepas'); });
function lukisMalam() {
  const d = new Date();
  $('jam-malam').textContent = d.toLocaleTimeString('ms-MY', { hour: 'numeric', minute: '2-digit' });
  $('rasa').innerHTML = RASA.map(r => '<button type="button" class="chip' + (r === rasaPilih ? ' on' : '') + '" data-r="' + r + '" aria-pressed="' + (r === rasaPilih) + '">' + r + '</button>').join('');
  $('rasa').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    rasaPilih = rasaPilih === b.dataset.r ? '' : b.dataset.r; lukisMalam();
    const balas = { Tenang: ['Bagus. Simpan rasa tenang tu.', 'senyum'], Penat: ['Penat tu tanda Tuan dah bagi banyak hari ni. Esok saya minta Claude ringankan.', 'tidur'], Risau: ['Tulis apa yang risau kat atas. Malam ni saya pegang, Tuan rehat.', 'risau'], Puas: ['Puas! Saya pun suka hari macam ni.', 'raikan'] };
    if (rasaPilih) nesty(balas[rasaPilih][0], balas[rasaPilih][1]);
  }));
}
$('simpan-malam').addEventListener('click', () => {
  const baris = $('esok').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!baris.length && !rasaPilih) { $('esok').focus(); return; }
  const masa = masaKini();
  if (baris.length) {
    hantar({ action: 'addNotes', items: baris.map(teks => ({ teks, bila: 'Esok', area: tekaArea(teks), masa })) });
    baris.forEach(teks => D.notes.unshift({ id: 'baru-' + Math.random(), masa, teks, area: tekaArea(teks), status: 'Baru', bila: 'Esok', tarikh: hariIni(1) }));
    store.set('data', D);
  }
  if (rasaPilih) hantar({ action: 'jurnal', rasa: rasaPilih, nota: '' });
  $('esok').value = ''; rasaPilih = ''; lukisMalam();
  nesty(baris.length ? '<b>' + baris.length + '</b> perkara saya simpan untuk esok. Selamat tidur, Tuan.' : 'Dah simpan. Selamat tidur, Tuan.', 'tidur', 4500);
  setTimeout(muat, 1500);
});

/* ---------- PETA ---------- */
function aktif(n) { return n.status !== 'Siap' && n.status !== 'Arkib'; }
function lukisPeta() {
  const el = $('peta');
  const W = el.clientWidth || 360, H = W * 1.05, cx = W / 2, cy = H / 2;
  const R = W * 0.36;
  const kira = a => D.notes.filter(n => aktif(n) && n.area === a).length;
  const pos = AREAS.map((a, i) => { const ang = -Math.PI / 2 + i * (2 * Math.PI / AREAS.length); return { a, x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), ang }; });

  let garis = '', html = '';
  if (!cabang) {
    pos.forEach(p => {
      garis += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p.x + '" y2="' + p.y + '" stroke="var(--garis)" stroke-width="2" stroke-linecap="round"/>';
      html += '<button type="button" class="node" style="left:' + p.x + 'px;top:' + p.y + 'px" data-a="' + esc(p.a) + '" aria-expanded="false">' + esc(p.a) + '<span class="n">' + kira(p.a) + '</span></button>';
    });
    html += '<div class="node pusat" style="left:' + cx + 'px;top:' + cy + 'px"><img src="img/glyph.png" alt="">Tuan</div>';
  } else {
    // Zum masuk cabang: cabang jadi pusat, daun (projek/fikiran) mengelilinginya
    const proj = D.projects.filter(x => x.area === cabang && x.status !== 'Siap').sort((a, b) => (a.status === 'Aktif' ? -1 : 0) - (b.status === 'Aktif' ? -1 : 0)).slice(0, 4);
    const nota = D.notes.filter(n => aktif(n) && n.area === cabang).slice(0, 4 - proj.length);
    const daun = proj.map(x => ({ t: x.nama, k: x.status })).concat(nota.map(n => ({ t: n.teks, k: 'Fikiran' })));
    const n = daun.length, R2 = W * 0.34;
    daun.forEach((d, i) => {
      const ang = -Math.PI / 2 + (n === 1 ? 0 : i * (2 * Math.PI / n)) + (n === 2 ? Math.PI / 2 : 0);
      const x = Math.max(W * 0.21, Math.min(W * 0.79, cx + W * 0.38 * Math.cos(ang))), y = cy + W * 0.4 * Math.sin(ang);
      garis += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '" stroke="var(--ungu)" stroke-width="2" stroke-linecap="round"/>';
      html += '<div class="daun" style="left:' + x + 'px;top:' + y + 'px">' + esc(d.t.length > 44 ? d.t.slice(0, 42) + '…' : d.t) + '<small style="display:block;color:var(--redup);font-size:11px;margin-top:2px">' + esc(d.k) + '</small></div>';
    });
    if (!n) html += '<div class="daun" style="left:' + cx + 'px;top:' + (cy + W * 0.3) + 'px">Cabang ini masih kosong</div>';
    html += '<button type="button" class="node pusat" style="left:' + cx + 'px;top:' + cy + 'px" data-a="' + esc(cabang) + '" aria-expanded="true">' + esc(cabang) + '<span class="n" style="color:#fff;opacity:.8">' + kira(cabang) + '</span></button>';
    html += '<button type="button" class="node" style="left:16%;top:6%" data-a="' + esc(cabang) + '">← Tuan</button>';
  }
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' + garis + '</svg>' + html;
  el.querySelectorAll('button.node').forEach(b => b.addEventListener('click', () => {
    cabang = cabang === b.dataset.a ? null : b.dataset.a; lukisPeta();
    if (cabang) {
      const nn = D.notes.filter(n => aktif(n) && n.area === cabang).length, pp = D.projects.filter(x => x.area === cabang && x.status === 'Aktif').length;
      nesty('Cabang <b>' + esc(cabang) + '</b>: ' + pp + ' projek aktif, ' + nn + ' fikiran terbuka.', 'fikir', 3500);
    } else nestyDiam();
  }));
  $('peta-sub').textContent = cabang ? 'Dalam cabang ' + cabang + '. Ketik pusat atau ← Tuan untuk keluar.' : 'Ketik satu cabang untuk masuk.';
  lukisKadPeta();
}

function umurHari(masa) { const t = Date.parse(String(masa).replace(' ', 'T')); return isNaN(t) ? 0 : Math.floor((Date.now() - t) / 864e5); }
function calonIngat() {
  const tahap = store.get('ingat', {});
  return D.notes.find(n => n.jenis === 'Idea' && aktif(n) && umurHari(n.masa) >= INGAT_SELANG[Math.min(tahap[n.id] || 0, INGAT_SELANG.length - 1)] && (tahap[n.id] || 0) < INGAT_SELANG.length);
}

function lukisKadPeta() {
  let h = '';
  const takBertempat = D.notes.filter(n => aktif(n) && !n.area);
  if (takBertempat.length) {
    const n = takBertempat[0];
    h += '<div class="kad madu"><div class="label"><span class="dot"></span>' + takBertempat.length + ' fikiran belum ada cabang</div>' +
      '<div class="t">' + esc(n.teks) + '</div><div class="row">' +
      AREAS.map(a => '<button type="button" class="chip" data-id="' + esc(n.id) + '" data-a="' + esc(a) + '">' + esc(a) + '</button>').join('') + '</div></div>';
  }
  const ing = calonIngat();
  if (ing) {
    h += '<div class="kad"><div class="label">Ingat lagi? Idea ' + umurHari(ing.masa) + ' hari lepas</div><div class="t">' + esc(ing.teks) + '</div>' +
      '<div class="row"><button type="button" class="btn utama" data-ing="aktif" data-id="' + esc(ing.id) + '">Fikir minggu ni</button>' +
      '<button type="button" class="btn" data-ing="nanti" data-id="' + esc(ing.id) + '">Nanti</button></div></div>';
  }
  $('peta-kad').innerHTML = h;
  $('peta-kad').querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
    const n = D.notes.find(x => x.id === b.dataset.id); if (n) n.area = b.dataset.a; store.set('data', D);
    if (!String(b.dataset.id).startsWith('baru-')) hantar({ action: 'setArea', id: b.dataset.id, area: b.dataset.a });
    nesty('Dah letak di cabang <b>' + esc(b.dataset.a) + '</b>.', 'gembira'); lukisPeta();
  }));
  $('peta-kad').querySelectorAll('[data-ing]').forEach(b => b.addEventListener('click', () => {
    const tahap = store.get('ingat', {}); tahap[b.dataset.id] = (tahap[b.dataset.id] || 0) + 1; store.set('ingat', tahap);
    if (b.dataset.ing === 'aktif') { hantar({ action: 'setBila', id: b.dataset.id, bila: 'Minggu ni' }); nesty('Okay, idea ni masuk minggu ni. Saya ingatkan.', 'gembira'); }
    else nesty('Baik, saya simpan. Nanti saya tanya lagi.', 'senyum');
    lukisKadPeta();
  }));
}

/* ---------- SEKARANG ---------- */
function selesaiHariIni() { const s = store.get('selesai', {}); return s[hariIni()] || []; }
function tandaSelesai(kunci) { const s = store.get('selesai', {}); const t = hariIni(); s[t] = (s[t] || []).concat(kunci); store.set('selesai', { [t]: s[t] }); }

function senaraiSekarang() {
  const t = hariIni(), done = selesaiHariIni();
  const isTugas = n => aktif(n) && n.status !== 'Baru' || (aktif(n) && n.bila);
  const lewat = D.notes.filter(n => isTugas(n) && n.jenis !== 'Idea' && n.tarikh && n.tarikh.slice(0, 10) < t && !done.includes('n:' + n.id))
    .sort((a, b) => a.tarikh.localeCompare(b.tarikh)).map(n => ({ jenis: 'nota', lewat: true, id: n.id, teks: n.teks, konteks: [n.area, n.projek].filter(Boolean).join(' · ') }));
  const hari = D.notes.filter(n => aktif(n) && n.jenis !== 'Idea' && ((n.tarikh && n.tarikh.slice(0, 10) === t) || n.bila === 'Hari ini') && !done.includes('n:' + n.id))
    .map(n => ({ jenis: 'nota', id: n.id, teks: n.teks, konteks: [n.area, n.projek, n.catatan].filter(Boolean).join(' · ') }));
  const fokus = (D.fokus && D.fokus.tarikh === t ? D.fokus.items : []).filter(f => !done.includes('f:' + f))
    .map(f => ({ jenis: 'fokus', id: f, teks: f, konteks: 'Fokus pagi daripada Claude' }));
  const projek = D.projects.filter(p => p.status === 'Aktif' && p.langkah && !done.includes('p:' + p.id))
    .map(p => ({ jenis: 'projek', id: p.id, teks: p.langkah, konteks: 'Projek ' + p.nama }));
  const semua = [], lihat = new Set();
  lewat.concat(hari, fokus, projek).forEach(x => { const k = x.teks.toLowerCase(); if (!lihat.has(k)) { lihat.add(k); semua.push(x); } });
  return semua;
}

function lukisSekarang() {
  const s = senaraiSekarang();
  const isi = $('sek-isi');
  $('nesty').classList.toggle('di-dalam', !s.length);
  if (!s.length) {
    $('sek-label').textContent = 'Sekarang';
    isi.innerHTML = '<img class="maskot" src="img/maskot.png" alt="Nesty"><p class="besar" style="text-align:center">Tiada apa yang mendesak.</p><p class="konteks" style="text-align:center">Nesty jaga yang lain. Kepala boleh rehat, atau lepaskan apa yang terlintas.</p>';
    return;
  }
  const x = s[0];
  const h = jam();
  $('sek-label').textContent = h >= 5 && h < 12 ? 'Pagi: buat ini dulu, otak masih segar' : (waktuMalam() ? 'Esok pagi, mula dengan ini' : 'Sekarang, buat ini sahaja');
  isi.innerHTML = (x.lewat ? '<span class="lewat">Lewat</span>' : '') +
    '<p class="besar">' + esc(x.teks) + '</p>' + (x.konteks ? '<p class="konteks">' + esc(x.konteks) + '</p>' : '') +
    '<div class="aksi"><button type="button" class="siap" id="b-siap">Siap</button>' +
    '<div class="grid2"><button type="button" class="lembut" id="b-esok">Esok</button><button type="button" class="lembut" id="b-pecah">Pecahkan kecil</button></div>' +
    '<div class="baki">' + (s.length > 1 ? (s.length - 1) + ' lagi, tersembunyi sampai yang ini selesai' : 'Ini yang terakhir untuk hari ini') + '</div></div>';

  $('b-siap').addEventListener('click', () => {
    tandaSelesai(x.jenis[0] + ':' + x.id);
    if (x.jenis === 'nota') { const n = D.notes.find(q => q.id === x.id); if (n) n.status = 'Siap'; store.set('data', D); if (!String(x.id).startsWith('baru-')) hantar({ action: 'setStatus', id: x.id, status: 'Siap' }); }
    const baki = senaraiSekarang().length;
    nesty(baki ? 'Yeay! Satu langkah bergerak.' : 'Semua siap untuk hari ini! Tuan hebat.', 'raikan', 2600);
    setTimeout(() => rehat(x, baki), 700);
  });
  $('b-esok').addEventListener('click', () => {
    tandaSelesai(x.jenis[0] + ':' + x.id);
    if (x.jenis === 'nota' && !String(x.id).startsWith('baru-')) hantar({ action: 'setBila', id: x.id, bila: 'Esok' });
    lukisSekarang(); nesty('Okay, saya bawa ke esok. Tak perlu fikir lagi malam ni.', 'senyum');
  });
  $('b-pecah').addEventListener('click', () => {
    const q = 'Pecahkan tugas ini kepada 3 langkah kecil yang boleh saya buat dalam 15 minit setiap satu: "' + x.teks + '"' + (x.konteks ? ' (' + x.konteks + ')' : '') + '. Jawab ringkas dalam Bahasa Melayu.';
    nesty('Saya minta Claude pecahkan jadi 3 langkah kecil…', 'fikir', 2500);
    setTimeout(() => window.open('https://claude.ai/new?q=' + encodeURIComponent(q), '_blank'), 500);
  });
}

function rehat(x, baki) {
  const p = $('panel'), l = $('lapis');
  $('nesty').classList.add('di-dalam');
  const tutupPanel = (kata) => { l.style.display = 'none'; lukisSekarang(); if (!$('sek-isi').querySelector('.maskot')) $('nesty').classList.remove('di-dalam'); if (kata) nesty(kata, 'senyum'); };
  p.innerHTML = '<img class="maskot kecil" src="img/maskot.png" alt="Nesty"><h2 style="margin:0;font-size:22px;text-align:center">' + (baki ? 'Satu langkah bergerak.' : 'Semua siap hari ini!') + '</h2><p class="sub" style="margin:0">' + esc(x.teks) + '</p>' +
    '<div class="row" style="margin-top:6px"><button type="button" class="btn utama" id="r-mula">Rehat 5 minit</button><button type="button" class="btn" id="r-terus">Teruskan</button></div>';
  l.style.display = 'flex';
  $('r-terus').addEventListener('click', () => tutupPanel(baki ? 'Jom. Ini yang seterusnya.' : ''));
  $('r-mula').addEventListener('click', () => {
    let s = 300;
    p.innerHTML = '<img class="maskot kecil" src="img/maskot.png" alt="Nesty" style="animation-duration:5s"><p class="sub" style="margin:0;text-align:center">Saya kira masa. Tuan jauhkan mata dari skrin.</p><div class="masa-rehat" id="r-masa">5:00</div><button type="button" class="btn" id="r-habis" style="align-self:center">Habis rehat</button>';
    const tick = setInterval(() => { s--; const el = $('r-masa'); if (el) el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); if (s <= 0) { clearInterval(tick); tutup(); } }, 1000);
    const tutup = () => { clearInterval(tick); tutupPanel(baki ? 'Rehat siap. Segar? Jom satu lagi.' : 'Rehat siap. Hari ni dah cukup baik.'); };
    $('r-habis').addEventListener('click', tutup);
  });
}

/* ---------- mula ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (!KUNCI) {
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('on', el.id === 's-kunci'));
} else {
  $('nav').hidden = false;
  $('nesty').hidden = false;
  const h = jam();
  skrinDisapa = { sekarang: Date.now(), lepas: Date.now(), malam: Date.now() }; // sapaan pembukaan ganti kata skrin
  pergi(h >= 5 && h < 12 ? 'sekarang' : 'lepas');
  setTimeout(() => nesty(sapaan() + ' ' + ringkasanNesty(), waktuMalam() ? 'tidur' : 'gembira', 6000), 500);
  siram().then(muat);

  // Ketik Nesty: ringkasan semasa
  $('nesty-btn').addEventListener('click', () => {
    const s = senaraiSekarang();
    nesty(ringkasanNesty() + (s.length && skrin !== 'sekarang' ? ' Nak saya tunjuk yang pertama? Ketik <b>Sekarang</b>.' : ''), s.some(x => x.lewat) ? 'risau' : 'fikir', 6000);
  });

  // Nesty perasan: tukar siang/malam, terlalu lama pada satu tugas, data baru
  let malamTadi = waktuMalam(), aksiTerakhir = Date.now(), dahTegur = '';
  ['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => (aksiTerakhir = Date.now()), { passive: true }));
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    lukis();
    if (waktuMalam() !== malamTadi) {
      malamTadi = waktuMalam();
      if (malamTadi) { nesty('Dah pukul 9. Masa tutup kepala. Nak tulis apa perlu esok?', 'tidur', 6000); if (skrin === 'lepas') pergi('lepas'); }
      else nesty(sapaan() + ' Hari baru. ' + ringkasanNesty(), 'gembira', 6000);
    }
    const x = skrin === 'sekarang' && senaraiSekarang()[0];
    if (x && Date.now() - aksiTerakhir > 25 * 60000 && dahTegur !== x.teks) {
      dahTegur = x.teks;
      nesty('Masih dengan yang ini? Kalau rasa berat, ketik <b>Pecahkan kecil</b>.', 'fikir', 7000);
    }
  }, 60000);
  setInterval(() => { if (document.visibilityState === 'visible') muat(); }, 5 * 60000); // semak perubahan dari Claude
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      siram().then(muat);
      if (Date.now() - nestyTerakhir.masa > 30 * 60000) nesty(sapaan() + ' Saya ada di sini. ' + ringkasanNesty(), waktuMalam() ? 'tidur' : 'senyum', 5000);
    }
  });
}
