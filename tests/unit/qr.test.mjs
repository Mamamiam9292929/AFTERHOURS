// W9 · QR-Code ohne Bibliothek (src/lib/qr.ts). Die Vergleichsmatrizen stammen aus dem QR-Encoder von OpenCV
// (cv2.QRCodeEncoder, Stufe M, Byte-Modus) – eine unabhängige Implementierung. Abweichen dürfen nur die
// Restbits der Versionen 2–6, die kein Lesegerät auswertet; deshalb Version 1 und 7 als Vergleich.
import assert from "node:assert/strict";
import { test } from "node:test";
import { qrMatrix, qrPath, qrVersionFor } from "../../src/lib/qr.ts";

const rows = (m) => m.map((r) => r.map((b) => (b ? "1" : "0")).join(""));

const HELLO_MASK4 = [
  "111111101101001111111",
  "100000100110101000001",
  "101110100111101011101",
  "101110101001001011101",
  "101110101000101011101",
  "100000101011001000001",
  "111111101010101111111",
  "000000001111100000000",
  "100010111111011111001",
  "000111001011100101111",
  "101100101011001110010",
  "111001000100011010000",
  "001011100100111000110",
  "000000001110111001011",
  "111111101100110001010",
  "100000100001100100010",
  "101110101001001110101",
  "101110100001100001011",
  "101110100111001111000",
  "100000100100011000000",
  "111111101000111110101",
];

const LINK = "https://afterhours.example/join/_nXL_cPZKcuzPrR2BImWS-EifkrvvBIQGVRRoLE-rnPf0jWsqRoWjCkIULo6JnfLbbl0ofyE1uo5vEun3WLG9Om";
const LINK_MASK6 = [
  "111111101010000100001011001010111000101111111",
  "100000101001000111010101101000010101001000001",
  "101110101000000000110010101100111101001011101",
  "101110100100101001100000100110111101101011101",
  "101110101101100101011111101000111011101011101",
  "100000100000110001101000111000010000001000001",
  "111111101010101010101010101010101010101111111",
  "000000000000110001111000101011110001000000000",
  "100111111101011110101111100010000010110010111",
  "100110000011000101100011011000101111101101010",
  "101011110111001010001011110010001111110100011",
  "010010011110111110011110011000010000011000100",
  "001101100001100010110100101010001100111010110",
  "101111001110010010000010101100110101101010010",
  "000010101001011011110011100011011110100111100",
  "010000010000110000011110001101000110101111100",
  "100111111011001110111101000000011001000000100",
  "010010001000100010010101110100101010110000000",
  "000011110001001100000110110110011100001011001",
  "001100011011001001001101111000100101011001110",
  "010111111001010000101111101010000100111110010",
  "011010001001101101011000111001111111100011100",
  "100110101000110010001010111100101010101011101",
  "001010001111111101011000101001110111100010101",
  "110111111111001010011111111111101101111110000",
  "011010000000100010100011001111110100110101010",
  "101010111110000010111101011110001000100111000",
  "001100011011101001110111111101110000000001110",
  "110010100001010010111000110000111011000011011",
  "010001000100100111100000010110110110001111100",
  "011110110110000000010101101010001100011110101",
  "000011010111011010010111100111100110010001110",
  "100101110010000011001010101011100010001100100",
  "101010010001101100000011011101111111110111101",
  "000010111111100111000011011000011011111101011",
  "011110011101000100000100110011111000101100101",
  "100110110110010000001111100011011011111111101",
  "000000001010101111011000101010101101100011110",
  "111111101101010011101010110111000111101010100",
  "100000101011111011111000101100000111100011111",
  "101110101011100010001111111001011100111110000",
  "101110101110000110101110010000101110000110011",
  "101110100011010011101100110110111101110011001",
  "100000100101111101010100011001100000101111111",
  "111111101100101001110010101010000001011011100",
];

test("gleich wie OpenCV: Version 1 („HELLO“, Maske 4) und Version 7 (Link mit 119 Zeichen, Maske 6)", () => {
  assert.deepEqual(rows(qrMatrix("HELLO", { mask: 4 })), HELLO_MASK4);
  assert.deepEqual(rows(qrMatrix(LINK, { mask: 6 })), LINK_MASK6);
});

test("Version nach Länge: Stufe M im Byte-Modus, höchstens Version 10", () => {
  assert.equal(qrVersionFor(14), 1);
  assert.equal(qrVersionFor(15), 2);
  assert.equal(qrVersionFor(84), 5);
  assert.equal(qrVersionFor(85), 6);
  assert.equal(qrVersionFor(213), 10);
  assert.equal(qrVersionFor(214), null);
  assert.equal(qrMatrix("x".repeat(214)), null, "zu lang: kein Code statt eines kaputten");
  // Einladungslink: Adresse + /join/ + 64 Zeichen Token
  const invite = "https://afterhours.example/join/" + "a".repeat(64);
  assert.equal(qrMatrix(invite).length, 4 * qrVersionFor(invite.length) + 17);
});

/** Formatbits oben links lesen und Maske zurückgeben (prüft dabei den BCH-Code und die Stufe M). */
function readMask(m) {
  const bits = [0, 1, 2, 3, 4, 5].map((i) => m[i][8]).concat([m[7][8], m[8][8], m[8][7]], [5, 4, 3, 2, 1, 0].map((i) => m[8][i]));
  const value = bits.reduce((acc, b, i) => acc | ((b ? 1 : 0) << i), 0) ^ 0x5412;
  const data = value >>> 10;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  assert.equal(value, (data << 10) | (rem & 0x3ff), "Formatbits gültig");
  assert.equal(data >>> 3, 0, "Fehlerkorrektur M");
  return data & 7;
}

test("automatische Maske: gültige Formatbits, beide Kopien gleich, dunkles Modul gesetzt", () => {
  for (const text of ["HELLO", LINK, "Grüße aus Leipzig 🎳", "https://afterhours.example/join/" + "Zz9-".repeat(16)]) {
    const m = qrMatrix(text);
    const size = m.length;
    const mask = readMask(m);
    assert.deepEqual(rows(qrMatrix(text, { mask })), rows(m), "Maske passt zur Matrix");
    const second = [...Array(8)].map((_, i) => m[8][size - 1 - i]).concat([...Array(7)].map((_, i) => m[size - 7 + i][8]));
    const first = [0, 1, 2, 3, 4, 5].map((i) => m[i][8]).concat([m[7][8], m[8][8], m[8][7]], [5, 4, 3, 2, 1, 0].map((i) => m[8][i]));
    assert.deepEqual(second, first, "zweite Kopie der Formatbits");
    assert.equal(m[size - 8][8], true, "dunkles Modul");
  }
});

test("Suchmuster in drei Ecken", () => {
  const m = qrMatrix(LINK);
  const size = m.length;
  const finder = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
  for (const [x0, y0] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    const got = finder.map((_, y) => [...Array(7)].map((_, x) => (m[y0 + y][x0 + x] ? "1" : "0")).join(""));
    assert.deepEqual(got, finder);
  }
});

test("SVG-Pfad: dunkle Läufe je Zeile, um die Ruhezone versetzt", () => {
  assert.equal(qrPath([[true, true, false, true], [false, false, false, false]], 4), "M4 4h2v1h-2zM7 4h1v1h-1z");
  assert.equal(qrPath([[false]]), "");
});
