const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const R = require("../report.js");

const ab = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const jpg = fs.readFileSync(path.join(__dirname, "fixtures/exif-gps.jpg"));

test("EXIF: capture time, offset, GPS and camera", () => {
  const m = R.parseExif(ab(jpg));
  assert.equal(m.taken, "2026-11-20 12:55:31");
  assert.equal(m.takenOffset, "+01:00");
  assert.ok(Math.abs(m.lat - 59.736761) < 1e-5);
  assert.ok(Math.abs(m.lon - 10.2096) < 1e-5);
  assert.equal(m.camera, "samsung SM-S911B");
});

test("EXIF: non-JPEG / garbage returns null", () => {
  assert.equal(R.parseExif(new Uint8Array([1, 2, 3, 4]).buffer), null);
  assert.equal(R.parseExif(new ArrayBuffer(0)), null);
});

test("readPhotoMeta: sha256 + exif + original flag", async () => {
  const file = { name: "a.jpg", type: "image/jpeg", size: jpg.length, lastModified: 0, arrayBuffer: async () => ab(jpg) };
  const m = await R.readPhotoMeta(file);
  assert.match(m.sha256, /^[0-9a-f]{64}$/);
  assert.equal(m.original, true);
  assert.equal(m.taken, "2026-11-20 12:55:31");
});

test("wrap keeps lines within width (incl. Norwegian letters, long words)", () => {
  const lines = R._wrap("Ødelagt himlingspanel og fukt i dampsperre æøå " + "x".repeat(300), 10, 200, false);
  for (const l of lines) assert.ok(R._textWidth(l, 10, false) <= 200.01, l);
});

test("buildReport produces a valid PDF with one page per photo", () => {
  const pdf = Buffer.from(R.buildReport({
    lang: "no", user: "t@example.com", createdAt: "2026-11-20T15:00:00Z",
    project: { name: "Bad", address: "Konglefaret 6", status: "Pågår", progress: 40, notes: "Lekkasje" },
    photos: [
      { jpeg: { bytes: jpg, w: 120, h: 70 }, meta: { taken: "2026-11-20 12:55:31", lat: 59.7, lon: 10.2, sha256: "ab".repeat(32), original: true }, analysis: "Fukt." },
      { jpeg: null, meta: null, analysis: null }
    ]
  }));
  const s = pdf.toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  assert.equal((s.match(/\/Type \/Page /g) || []).length, 3);
  assert.equal((s.match(/\/Subtype \/Image/g) || []).length, 1);
  const startxref = Number(s.match(/startxref\n(\d+)/)[1]);
  assert.equal(s.slice(startxref, startxref + 4), "xref");
});

test("plainText strips Markdown from AI text", () => {
  assert.equal(R.plainText("**Observasjoner:**\n## Tiltak\n* punkt\n- ok `kode`"), "Observasjoner:\nTiltak\n- punkt\n- ok kode");
});
