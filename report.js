/* Byggvakt AI – photo metadata (EXIF time + GPS, SHA-256) and PDF "Skaderapport".
 * No external libraries. Works in the browser (window.ByggvaktReport) and in Node (tests).
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- EXIF ---
  // Reads capture time and GPS from a JPEG's EXIF block. Returns null if none.
  function parseExif(buffer) {
    try {
      const dv = new DataView(buffer);
      if (dv.byteLength < 4 || dv.getUint16(0) !== 0xffd8) return null;
      let off = 2;
      while (off + 4 <= dv.byteLength) {
        const marker = dv.getUint16(off);
        if ((marker & 0xff00) !== 0xff00) return null;
        if (marker === 0xffda || marker === 0xffd9) return null;
        const len = dv.getUint16(off + 2);
        if (marker === 0xffe1 && off + 10 <= dv.byteLength &&
            dv.getUint32(off + 4) === 0x45786966 /* "Exif" */) {
          return parseTiff(dv, off + 10);
        }
        off += 2 + len;
      }
    } catch (e) { /* malformed: ignore */ }
    return null;
  }

  function parseTiff(dv, start) {
    const le = dv.getUint16(start) === 0x4949;
    const u16 = o => dv.getUint16(o, le);
    const u32 = o => dv.getUint32(o, le);
    const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

    function readIfd(rel) {
      const tags = {};
      const base = start + rel;
      if (base + 2 > dv.byteLength) return tags;
      const n = u16(base);
      for (let i = 0; i < n; i++) {
        const e = base + 2 + i * 12;
        if (e + 12 > dv.byteLength) break;
        const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        const size = (SIZES[type] || 1) * count;
        const valueAt = size <= 4 ? e + 8 : start + u32(e + 8);
        tags[tag] = { type, count, at: valueAt };
      }
      return tags;
    }
    function ascii(t) {
      if (!t || t.at + t.count > dv.byteLength) return null;
      let s = "";
      for (let i = 0; i < t.count; i++) {
        const c = dv.getUint8(t.at + i);
        if (!c) break;
        s += String.fromCharCode(c);
      }
      return s.trim() || null;
    }
    function rationals(t) {
      if (!t || t.type !== 5 || t.at + t.count * 8 > dv.byteLength) return null;
      const out = [];
      for (let i = 0; i < t.count; i++) {
        const d = u32(t.at + i * 8 + 4);
        out.push(d ? u32(t.at + i * 8) / d : 0);
      }
      return out;
    }
    function pointer(t) { return t && (t.type === 4 || t.type === 13) ? u32(t.at) : null; }

    if (u16(start + 2) !== 42) return null;
    const ifd0 = readIfd(u32(start + 4));
    const exifPtr = pointer(ifd0[0x8769]);
    const gpsPtr = pointer(ifd0[0x8825]);
    const exif = exifPtr != null ? readIfd(exifPtr) : {};
    const gps = gpsPtr != null ? readIfd(gpsPtr) : {};

    const out = {};
    const dt = ascii(exif[0x9003]) || ascii(exif[0x9004]) || ascii(ifd0[0x0132]);
    const m = dt && dt.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (m && m[1] !== "0000") {
      out.taken = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
      const tz = ascii(exif[0x9011]) || ascii(exif[0x9010]);
      if (tz && /^[+-]\d{2}:\d{2}$/.test(tz)) out.takenOffset = tz;
    }
    const lat = rationals(gps[2]), lon = rationals(gps[4]);
    if (lat && lon && lat.length >= 3 && lon.length >= 3) {
      let la = lat[0] + lat[1] / 60 + lat[2] / 3600;
      let lo = lon[0] + lon[1] / 60 + lon[2] / 3600;
      if ((ascii(gps[1]) || "N").toUpperCase() === "S") la = -la;
      if ((ascii(gps[3]) || "E").toUpperCase() === "W") lo = -lo;
      if (Number.isFinite(la) && Number.isFinite(lo) && (la !== 0 || lo !== 0) &&
          Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
        out.lat = Math.round(la * 1e6) / 1e6;
        out.lon = Math.round(lo * 1e6) / 1e6;
      }
    }
    const make = ascii(ifd0[0x010f]), model = ascii(ifd0[0x0110]);
    if (model) out.camera = (make && !model.startsWith(make) ? make + " " : "") + model;
    return Object.keys(out).length ? out : null;
  }

  async function sha256Hex(buffer) {
    const c = root.crypto && root.crypto.subtle;
    if (!c) return null;
    const h = await c.digest("SHA-256", buffer);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // Metadata stored with each photo when it is uploaded (file = the exact bytes uploaded).
  async function readPhotoMeta(file, extra) {
    const buf = await file.arrayBuffer();
    const meta = Object.assign({
      uploaded: new Date().toISOString(),
      name: String(file.name || "").slice(0, 120),
      type: file.type || "",
      size: file.size,
      original: true
    }, parseExif(buf) || {}, extra || {});
    try { meta.sha256 = await sha256Hex(buf); } catch (e) { /* not critical */ }
    if (!meta.taken && file.lastModified) meta.fileDate = new Date(file.lastModified).toISOString();
    return meta;
  }

  // ----------------------------------------------------------------- PDF ---
  const W = {32:278,33:278,34:355,35:556,36:556,37:889,38:667,39:191,40:333,41:333,42:389,43:584,44:278,45:333,46:278,47:278,
    58:278,59:278,60:584,61:584,62:584,63:556,64:1015,65:667,66:667,67:722,68:722,69:667,70:611,71:778,72:722,73:278,74:500,
    75:667,76:556,77:833,78:722,79:778,80:667,81:778,82:722,83:667,84:611,85:722,86:667,87:944,88:667,89:667,90:611,91:278,
    92:278,93:278,94:469,95:556,96:333,97:556,98:556,99:500,100:556,101:556,102:278,103:556,104:556,105:222,106:222,107:500,
    108:222,109:833,110:556,111:556,112:556,113:556,114:333,115:500,116:278,117:556,118:500,119:722,120:500,121:500,122:500,
    123:334,124:260,125:334,126:584,128:556,133:1000,145:222,146:222,147:333,148:333,149:350,150:556,151:1000,
    160:278,169:737,171:556,176:400,183:278,187:556,197:667,198:1000,216:778,223:611,229:556,230:889,248:611};
  for (let c = 48; c <= 57; c++) W[c] = 556;
  const WIN = { 0x20ac:128, 0x201a:130, 0x201e:132, 0x2026:133, 0x2018:145, 0x2019:146, 0x201c:147, 0x201d:148,
    0x2022:149, 0x2013:150, 0x2014:151, 0x2122:153 };

  function winCode(ch) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) return c;
    if (c >= 160 && c <= 255) return c;
    if (WIN[c]) return WIN[c];
    if (c === 9) return 32;
    return 63; // '?'
  }
  function charWidth(code, bold) {
    let w = W[code];
    if (w == null) {
      if (code >= 192 && code <= 214) w = code >= 210 ? 778 : code >= 200 && code <= 203 ? 667 : code >= 204 && code <= 207 ? 278 : 722;
      else if (code >= 224 && code <= 255) w = (code >= 236 && code <= 239) ? 278 : 556;
      else w = 556;
    }
    return bold ? w * 1.1 : w;
  }
  function textWidth(str, size, bold) {
    let w = 0;
    for (const ch of String(str)) w += charWidth(winCode(ch), bold);
    return (w * size) / 1000;
  }
  function hexText(str) {
    let h = "";
    for (const ch of String(str)) h += winCode(ch).toString(16).padStart(2, "0");
    return "<" + h + ">";
  }
  function wrap(text, size, maxW, bold) {
    const lines = [];
    for (const para of String(text || "").replace(/\r/g, "").split("\n")) {
      if (!para.trim()) { lines.push(""); continue; }
      let line = "";
      for (let word of para.split(/ +/)) {
        while (textWidth(word, size, bold) > maxW) {      // very long word: hard break
          let cut = word.length;
          while (cut > 1 && textWidth(word.slice(0, cut), size, bold) > maxW) cut--;
          if (line) { lines.push(line); line = ""; }
          lines.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        const next = line ? line + " " + word : word;
        if (textWidth(next, size, bold) <= maxW) line = next;
        else { if (line) lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  }

  const enc = s => {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  };

  // Minimal PDF writer: A4 pages, Helvetica (WinAnsi), JPEG images.
  function PdfDoc() {
    this.pages = [];
    this.images = [];
    this.W = 595.28; this.H = 841.89;
  }
  PdfDoc.prototype.addPage = function () { const p = { ops: [] }; this.pages.push(p); return p; };
  PdfDoc.prototype.addJpeg = function (bytes, w, h) { this.images.push({ bytes, w, h }); return "Im" + this.images.length; };
  PdfDoc.prototype.build = function () {
    const objs = [];                     // each: string or {dict, stream(Uint8Array)}
    const add = o => { objs.push(o); return objs.length; };
    const catalog = add(null), pagesId = add(null);
    const fontR = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontB = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const imgIds = this.images.map(im => add({
      dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`,
      stream: im.bytes
    }));
    const xobj = imgIds.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(" ");
    const kids = [];
    for (const p of this.pages) {
      const content = enc(p.ops.join("\n"));
      const cId = add({ dict: `<< /Length ${content.length} >>`, stream: content });
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.W} ${this.H}] ` +
        `/Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R >> /XObject << ${xobj} >> >> /Contents ${cId} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;

    const chunks = [enc("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
    let len = chunks[0].length;
    const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(len);
      const parts = typeof o === "string"
        ? [enc(`${i + 1} 0 obj\n${o}\nendobj\n`)]
        : [enc(`${i + 1} 0 obj\n${o.dict}\nstream\n`), o.stream, enc("\nendstream\nendobj\n")];
      for (const p of parts) { chunks.push(p); len += p.length; }
    });
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += String(off).padStart(10, "0") + " 00000 n \n";
    xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${len}\n%%EOF\n`;
    chunks.push(enc(xref));
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  };

  const n = v => (Math.round(v * 100) / 100).toString();

  // Layout helper with automatic page breaks.
  function Writer(doc) {
    this.doc = doc; this.margin = 48; this.y = 0; this.page = null;
    this.maxW = doc.W - 2 * this.margin;
    this.newPage();
  }
  Writer.prototype.newPage = function () { this.page = this.doc.addPage(); this.y = this.doc.H - this.margin; };
  Writer.prototype.ensure = function (h) { if (this.y - h < this.margin + 24) this.newPage(); };
  Writer.prototype.text = function (str, opts) {
    const o = Object.assign({ size: 10, bold: false, color: [0.1, 0.12, 0.12], gap: 1.35, indent: 0 }, opts || {});
    const lines = wrap(str, o.size, this.maxW - o.indent, o.bold);
    for (const line of lines) {
      this.ensure(o.size * o.gap);
      this.y -= o.size * o.gap;
      if (line) this.page.ops.push(`BT ${o.color.map(n).join(" ")} rg /${o.bold ? "F2" : "F1"} ${o.size} Tf ` +
        `${n(this.margin + o.indent)} ${n(this.y)} Td ${hexText(line)} Tj ET`);
    }
  };
  Writer.prototype.space = function (h) { this.y -= h; };
  Writer.prototype.rule = function () {
    this.ensure(10); this.y -= 6;
    this.page.ops.push(`0.8 0.84 0.82 RG 0.6 w ${n(this.margin)} ${n(this.y)} m ${n(this.doc.W - this.margin)} ${n(this.y)} l S`);
    this.y -= 6;
  };
  Writer.prototype.field = function (label, value) {
    const lw = 120;
    const lines = wrap(value || "–", 10, this.maxW - lw, false);
    this.ensure(13.5 * lines.length);
    lines.forEach((line, i) => {
      this.y -= 13.5;
      if (i === 0) this.page.ops.push(`BT 0.35 0.4 0.38 rg /F2 9 Tf ${n(this.margin)} ${n(this.y)} Td ${hexText(label)} Tj ET`);
      if (line) this.page.ops.push(`BT 0.1 0.12 0.12 rg /F1 10 Tf ${n(this.margin + lw)} ${n(this.y)} Td ${hexText(line)} Tj ET`);
    });
  };
  Writer.prototype.image = function (name, w, h, maxH) {
    const scale = Math.min(this.maxW / w, maxH / h, 1.5);
    const dw = w * scale, dh = h * scale;
    this.ensure(dh + 8);
    this.y -= dh;
    const x = this.margin + (this.maxW - dw) / 2;
    this.page.ops.push(`q ${n(dw)} 0 0 ${n(dh)} ${n(x)} ${n(this.y)} cm /${name} Do Q`);
    this.y -= 8;
  };
  Writer.prototype.box = function (str, size) {
    const lines = wrap(str, size, this.maxW - 20, false);
    const h = lines.length * size * 1.35 + 14;
    this.ensure(h + 4);
    const top = this.y;
    this.page.ops.push(`0.95 0.97 0.95 rg 0.75 0.82 0.78 RG 0.6 w ${n(this.margin)} ${n(top - h)} ${n(this.maxW)} ${n(h)} re B`);
    let y = top - 7;
    for (const line of lines) {
      y -= size * 1.35;
      if (line) this.page.ops.push(`BT 0.2 0.25 0.23 rg /F1 ${size} Tf ${n(this.margin + 10)} ${n(y + 2)} Td ${hexText(line)} Tj ET`);
    }
    this.y = top - h - 6;
  };

  function fmtDate(iso, locale) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  const TXT = {
    no: { title: "SKADERAPPORT", project: "Prosjekt", address: "Adresse", status: "Status", progress: "Fremdrift",
      made: "Rapport laget", by: "Laget av", count: "Antall bilder", notes: "Beskrivelse / notater", photo: "Bilde",
      of: "av", taken: "Tatt (fra bildet)", fileDate: "Fildato", uploaded: "Lastet opp", position: "Posisjon (GPS)",
      camera: "Kamera", file: "Fil", original: "Original", origYes: "Ja – uendret originalfil", origNo: "Nei – konvertert til JPG",
      hash: "SHA-256", ai: "AI-vurdering (veiledende)", noAi: "Ingen AI-vurdering for dette bildet.", unknown: "Ukjent",
      noPos: "Ikke registrert i bildet", noImg: "Bildet kunne ikke vises i rapporten.", page: "Side",
      disclaimer: "Rapporten dokumenterer bilder, tidspunkt og posisjon slik de er lagret i Byggvakt AI. AI-vurderingen er " +
        "veiledende og erstatter ikke befaring av takstmann eller fagperson. Tidspunkt og posisjon hentes fra bildefilens " +
        "metadata (EXIF) når de finnes. SHA-256 er et fingeravtrykk av den lagrede filen og kan brukes til å kontrollere at den ikke er endret." },
    en: { title: "DAMAGE REPORT", project: "Project", address: "Address", status: "Status", progress: "Progress",
      made: "Report created", by: "Created by", count: "Number of photos", notes: "Description / notes", photo: "Photo",
      of: "of", taken: "Taken (from photo)", fileDate: "File date", uploaded: "Uploaded", position: "Position (GPS)",
      camera: "Camera", file: "File", original: "Original", origYes: "Yes – unmodified original file", origNo: "No – converted to JPG",
      hash: "SHA-256", ai: "AI assessment (guidance)", noAi: "No AI assessment for this photo.", unknown: "Unknown",
      noPos: "Not recorded in the photo", noImg: "The photo could not be shown in the report.", page: "Page",
      disclaimer: "This report documents photos, times and positions as stored in Byggvakt AI. The AI assessment is guidance " +
        "only and does not replace an inspection by a loss adjuster or professional. Time and position come from the image " +
        "file's metadata (EXIF) when available. SHA-256 is a fingerprint of the stored file that can be used to verify it has not been changed." }
  };

  /* data = { lang, project:{name,address,status,progress,notes}, user, createdAt,
   *   photos:[{ jpeg:{bytes,w,h}|null, meta:{...}|null, analysis:string|null, analysisDate }] } */
  function buildReport(data) {
    const L = TXT[data.lang === "en" ? "en" : "no"];
    const locale = data.lang === "en" ? "en-GB" : "nb-NO";
    const doc = new PdfDoc();
    const w = new Writer(doc);
    const green = [0.063, 0.235, 0.2];

    w.text(L.title, { size: 22, bold: true, color: green, gap: 1.1 });
    w.text("Byggvakt AI · byggvaktai.com", { size: 9, color: [0.4, 0.45, 0.43] });
    w.rule();
    const p = data.project || {};
    w.field(L.project, p.name);
    w.field(L.address, p.address);
    w.field(L.status, p.status);
    w.field(L.progress, p.progress != null ? p.progress + " %" : null);
    w.field(L.made, fmtDate(data.createdAt || new Date().toISOString(), locale));
    w.field(L.by, data.user);
    w.field(L.count, String((data.photos || []).length));
    if (p.notes && p.notes.trim()) {
      w.space(8);
      w.text(L.notes, { size: 12, bold: true, color: green });
      w.text(p.notes.trim(), { size: 10 });
    }
    w.space(8);
    w.box(L.disclaimer, 8.5);

    const photos = data.photos || [];
    photos.forEach((ph, i) => {
      w.newPage();
      w.text(`${L.photo} ${i + 1} ${L.of} ${photos.length}`, { size: 14, bold: true, color: green });
      w.space(4);
      if (ph.jpeg) w.image(doc.addJpeg(ph.jpeg.bytes, ph.jpeg.w, ph.jpeg.h), ph.jpeg.w, ph.jpeg.h, 380);
      else w.text(L.noImg, { size: 10, color: [0.6, 0.2, 0.2] });
      const m = ph.meta || {};
      const taken = m.taken ? m.taken.replace(/^(\d{4})-(\d{2})-(\d{2})/, data.lang === "en" ? "$3/$2/$1" : "$3.$2.$1") + (m.takenOffset ? " (UTC" + m.takenOffset + ")" : "") : null;
      w.field(L.taken, taken || L.unknown);
      if (!m.taken && m.fileDate) w.field(L.fileDate, fmtDate(m.fileDate, locale));
      w.field(L.uploaded, fmtDate(m.uploaded, locale) || L.unknown);
      w.field(L.position, m.lat != null ? `${m.lat.toFixed(6)}, ${m.lon.toFixed(6)}  –  https://maps.google.com/?q=${m.lat},${m.lon}` : L.noPos);
      if (m.camera) w.field(L.camera, m.camera);
      if (m.name) w.field(L.file, m.name + (m.size ? ` (${Math.round(m.size / 1024)} kB)` : ""));
      if (m.original != null) w.field(L.original, m.original ? L.origYes : L.origNo);
      if (m.sha256) w.field(L.hash, m.sha256);
      w.space(6);
      w.text(L.ai + (ph.analysisDate ? " – " + ph.analysisDate : ""), { size: 11, bold: true, color: green });
      w.text(ph.analysis && ph.analysis.trim() ? ph.analysis.trim() : L.noAi, { size: 9.5 });
    });

    const total = doc.pages.length;
    doc.pages.forEach((pg, i) => {
      const label = `Byggvakt AI · ${L.title.charAt(0) + L.title.slice(1).toLowerCase()} · ${L.page} ${i + 1} ${L.of} ${total}`;
      pg.ops.push(`BT 0.5 0.55 0.53 rg /F1 8 Tf ${n(48)} ${n(28)} Td ${hexText(label)} Tj ET`);
    });
    return doc.build();
  }

  const api = { parseExif, readPhotoMeta, sha256Hex, buildReport, _wrap: wrap, _textWidth: textWidth };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ByggvaktReport = api;
})(typeof window !== "undefined" ? window : globalThis);
