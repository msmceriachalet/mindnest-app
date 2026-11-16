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

function toast(m, ms) {
  const t = $('toast'); t.textContent = m; t.style.display = 'block';
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.style.display = 'none'), ms || 2600);
}

/* ---------- rangkaian + barisan offline ---------- */
async function muat() {
  if (!KUNCI) return;
  try {
    const r = await fetch(API + '?k=' + encodeURIComponent(KUNCI), { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) { $('sync').textContent = j.error === 'Kunci tidak sah' ? 'Kunci tidak sah' : 'Ralat data'; return; }
    D = j.data; store.set('data', D); $('sync').textContent = '';
    lukis();
  } catch (e) { $('sync').textContent = 'Luar talian'; }
}

function hantar(body) {
  const q = store.get('q', []); q.push(Object.assign({ k: KUNCI }, body)); store.set('q', q);
  return siram();
}
let menyiram = false;
async function siram() {
  if (menyiram || !navigator.onLine) { $('sync').textContent = navigator.onLine ? '' : 'Luar talian · disimpan dalam phone'; return; }
  menyiram = true;
  try {
    let q = store.get('q', []);
    while (q.length) {
      const item = q[0];
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(item) });
      const j = await r.json();
      if (!j.ok && j.error !== 'Nota tidak dijumpai') throw new Error(j.error);
      q.shift(); store.set('q', q);
    }
    $('sync').textContent = '';
  } catch (e) {
    $('sync').textContent = 'Belum dihantar · cuba lagi nanti';
  } finally { menyiram = false; }
}
window.addEventListener('online', () => { siram().then(muat); });

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
  r.onstart = () => { butang.classList.add('dengar'); if (label) label.textContent = 'Sedang dengar…'; };
  r.onresult = e => {
    let txt = ''; for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
    sasaran.value = asal + txt; sasaran.dispatchEvent(new Event('input'));
  };
  r.onerror = () => toast('Tak dapat dengar. Cuba lagi atau taip.');
  r.onend = () => { butang.classList.remove('dengar'); if (label) label.textContent = 'Tekan dan cakap'; };
  r.start();
}

/* ---------- navigasi ---------- */
function pergi(s) {
  if (s === 'lepas' && waktuMalam() && !modSiang) s = 'malam';
  skrin = s;
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('on', el.id === 's-' + s));
  document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-current', (b.dataset.s === s || (s === 'malam' && b.dataset.s === 'lepas')) ? 'page' : 'false'));
  lukis(); window.scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => { cabang = null; pergi(b.dataset.s); }));

function lukis() {
  document.body.classList.toggle('malam', waktuMalam());
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
  if (t) { bilaPilih = ''; areaPilih = tekaArea(t); lukisLepas(); }
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
    c.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { areaPilih = b.dataset.a; c.hidden = true; lukisLepas(); }));
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
  toast(bila === 'Satu hari nanti' ? 'Disimpan untuk satu hari nanti. Kepala boleh lupakan dulu.' : 'Dilepaskan ke ' + bila.toLowerCase() + '. Kepala boleh rehat.');
}

/* ---------- MALAM ---------- */
$('mic-malam').addEventListener('click', () => dengar($('esok'), $('mic-malam')));
$('ke-siang').addEventListener('click', () => { modSiang = true; pergi('lepas'); });
function lukisMalam() {
  const d = new Date();
  $('jam-malam').textContent = d.toLocaleTimeString('ms-MY', { hour: 'numeric', minute: '2-digit' });
  $('rasa').innerHTML = RASA.map(r => '<button type="button" class="chip' + (r === rasaPilih ? ' on' : '') + '" data-r="' + r + '" aria-pressed="' + (r === rasaPilih) + '">' + r + '</button>').join('');
  $('rasa').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { rasaPilih = rasaPilih === b.dataset.r ? '' : b.dataset.r; lukisMalam(); }));
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
  toast(baris.length ? baris.length + ' perkara disimpan untuk esok. Selamat berehat.' : 'Disimpan. Selamat berehat.', 3500);
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
  pos.forEach(p => {
    const on = cabang === p.a;
    garis += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p.x + '" y2="' + p.y + '" stroke="' + (on ? 'var(--lumut)' : 'var(--garis)') + '" stroke-width="' + (on ? 3 : 2) + '" stroke-linecap="round"/>';
    html += '<button type="button" class="node' + (on ? ' buka' : (cabang ? ' senyap' : '')) + '" style="left:' + p.x + 'px;top:' + p.y + 'px" data-a="' + esc(p.a) + '" aria-expanded="' + on + '">' + esc(p.a) + '<span class="n">' + kira(p.a) + '</span></button>';
  });

  if (cabang) {
    const p = pos.find(q => q.a === cabang);
    const proj = D.projects.filter(x => x.area === cabang && x.status !== 'Siap').sort((a, b) => (a.status === 'Aktif' ? -1 : 0) - (b.status === 'Aktif' ? -1 : 0)).slice(0, 3);
    const daun = proj.length ? proj.map(x => x.nama) : D.notes.filter(n => aktif(n) && n.area === cabang).slice(0, 3).map(n => n.teks);
    const r2 = W * 0.2;
    daun.forEach((t, i) => {
      const ang = p.ang + (i - (daun.length - 1) / 2) * 0.75;
      let x = p.x + r2 * Math.cos(ang), y = p.y + r2 * Math.sin(ang);
      x = Math.max(W * 0.2, Math.min(W * 0.8, x)); y = Math.max(20, Math.min(H - 20, y));
      garis += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + x + '" y2="' + y + '" stroke="var(--lumut)" stroke-width="1.5"/>';
      html += '<div class="daun" style="left:' + x + 'px;top:' + y + 'px">' + esc(t.length > 40 ? t.slice(0, 38) + '…' : t) + '</div>';
    });
  }
  html += '<div class="node pusat" style="left:' + cx + 'px;top:' + cy + 'px">Tuan</div>';
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' + garis + '</svg>' + html;
  el.querySelectorAll('button.node').forEach(b => b.addEventListener('click', () => { cabang = cabang === b.dataset.a ? null : b.dataset.a; lukisPeta(); }));
  $('peta-sub').textContent = cabang ? 'Cabang ' + cabang + ' terbuka. Ketik lagi untuk tutup.' : 'Ketik satu cabang. Yang lain senyap.';
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
    toast('Diletak di cabang ' + b.dataset.a); lukisPeta();
  }));
  $('peta-kad').querySelectorAll('[data-ing]').forEach(b => b.addEventListener('click', () => {
    const tahap = store.get('ingat', {}); tahap[b.dataset.id] = (tahap[b.dataset.id] || 0) + 1; store.set('ingat', tahap);
    if (b.dataset.ing === 'aktif') { hantar({ action: 'setBila', id: b.dataset.id, bila: 'Minggu ni' }); toast('Masuk senarai minggu ni.'); }
    else toast('Akan diingatkan lagi kemudian.');
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
  if (!s.length) {
    $('sek-label').textContent = 'Sekarang';
    isi.innerHTML = '<p class="besar">Tiada apa yang mendesak.</p><p class="konteks">Kepala boleh rehat, atau lepaskan apa yang terlintas.</p>';
    return;
  }
  const x = s[0];
  $('sek-label').textContent = jam() < 12 ? 'Pagi: buat ini dulu, otak masih segar' : 'Sekarang, buat ini sahaja';
  isi.innerHTML = (x.lewat ? '<span class="lewat">Lewat</span>' : '') +
    '<p class="besar">' + esc(x.teks) + '</p>' + (x.konteks ? '<p class="konteks">' + esc(x.konteks) + '</p>' : '') +
    '<div class="aksi"><button type="button" class="siap" id="b-siap">Siap</button>' +
    '<div class="grid2"><button type="button" class="lembut" id="b-esok">Esok</button><button type="button" class="lembut" id="b-pecah">Pecahkan kecil</button></div>' +
    '<div class="baki">' + (s.length > 1 ? (s.length - 1) + ' lagi, tersembunyi sampai yang ini selesai' : 'Ini yang terakhir untuk hari ini') + '</div></div>';

  $('b-siap').addEventListener('click', () => {
    tandaSelesai(x.jenis[0] + ':' + x.id);
    if (x.jenis === 'nota') { const n = D.notes.find(q => q.id === x.id); if (n) n.status = 'Siap'; store.set('data', D); if (!String(x.id).startsWith('baru-')) hantar({ action: 'setStatus', id: x.id, status: 'Siap' }); }
    rehat(x);
  });
  $('b-esok').addEventListener('click', () => {
    tandaSelesai(x.jenis[0] + ':' + x.id);
    if (x.jenis === 'nota' && !String(x.id).startsWith('baru-')) hantar({ action: 'setBila', id: x.id, bila: 'Esok' });
    toast('Dipindah ke esok.'); lukisSekarang();
  });
  $('b-pecah').addEventListener('click', () => {
    const q = 'Pecahkan tugas ini kepada 3 langkah kecil yang boleh saya buat dalam 15 minit setiap satu: "' + x.teks + '"' + (x.konteks ? ' (' + x.konteks + ')' : '') + '. Jawab ringkas dalam Bahasa Melayu.';
    window.open('https://claude.ai/new?q=' + encodeURIComponent(q), '_blank');
  });
}

function rehat(x) {
  const p = $('panel'), l = $('lapis');
  p.innerHTML = '<h2 style="margin:0;font-size:22px">Satu langkah bergerak.</h2><p class="sub" style="margin:0">' + esc(x.teks) + '</p>' +
    '<div class="row" style="margin-top:6px"><button type="button" class="btn utama" id="r-mula">Rehat 5 minit</button><button type="button" class="btn" id="r-terus">Teruskan</button></div>';
  l.style.display = 'flex';
  $('r-terus').addEventListener('click', () => { l.style.display = 'none'; lukisSekarang(); });
  $('r-mula').addEventListener('click', () => {
    let s = 300;
    p.innerHTML = '<p class="sub" style="margin:0;text-align:center">Rehat. Jauhkan mata dari skrin.</p><div class="masa-rehat" id="r-masa">5:00</div><button type="button" class="btn" id="r-habis" style="align-self:center">Habis rehat</button>';
    const tick = setInterval(() => { s--; const el = $('r-masa'); if (el) el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); if (s <= 0) { clearInterval(tick); tutup(); } }, 1000);
    const tutup = () => { clearInterval(tick); l.style.display = 'none'; lukisSekarang(); };
    $('r-habis').addEventListener('click', tutup);
  });
}

/* ---------- mula ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (!KUNCI) {
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('on', el.id === 's-kunci'));
} else {
  $('nav').hidden = false;
  const h = jam();
  pergi(h >= 5 && h < 12 ? 'sekarang' : 'lepas');
  siram().then(muat);
  setInterval(() => { if (document.visibilityState === 'visible') lukis(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { siram().then(muat); } });
}
