// S3 · Teilen-Ziel (src/lib/sharetarget.ts) – was WhatsApp, Signal, Telegram & Co. beim Teilen mitschicken.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuickPoll } from "../../src/lib/quickpoll.ts";
import { MAX_SENTENCE, sharedSentence, sharedSentenceFromSearch } from "../../src/lib/sharetarget.ts";

test("einfacher Text bleibt, wie er ist", () => {
  assert.equal(sharedSentence({ text: "bowling oder kino, fr oder sa, 20 uhr" }), "bowling oder kino, fr oder sa, 20 uhr");
});

test("Kopf einer weitergeleiteten Chat-Nachricht fällt weg (iOS und Android, mit Sekunden, vierstelliges Jahr)", () => {
  assert.equal(sharedSentence({ text: "[19.10.26, 21:04] Carol: minigolf oder billard, sa 19 uhr" }), "minigolf oder billard, sa 19 uhr");
  assert.equal(sharedSentence({ text: "19.10.26, 21:04 - Carol Müller: kino morgen" }), "kino morgen");
  assert.equal(sharedSentence({ text: "[19.10.2026, 21:04:59] Max: bar?" }), "bar?");
});

test("Links fallen weg, Text drumherum bleibt", () => {
  assert.equal(sharedSentence({ text: "kino fr https://kino.example/film?id=1 oder bowling" }), "kino fr oder bowling");
  assert.equal(sharedSentence({ text: "www.example.de bowling sa" }), "bowling sa");
});

test("mehrere Zeilen werden ein Satz mit Kommas", () => {
  const text = "[19.10.26, 21:04] Carol: bowling oder kino\n[19.10.26, 21:05] Bob: fr oder sa\n\n20 uhr";
  assert.equal(sharedSentence({ text }), "bowling oder kino, fr oder sa, 20 uhr");
  assert.equal(sharedSentence({ text: "heute noch bar?\nab 21 uhr" }), "heute noch bar? ab 21 uhr");
});

test("Anführungszeichen außen und doppelte Leerzeichen verschwinden", () => {
  assert.equal(sharedSentence({ text: "  „bowling   am samstag“  " }), "bowling am samstag");
  assert.equal(sharedSentence({ text: "\"kino?\"" }), "kino?");
});

test("ohne brauchbaren Text: Titel, sonst leer", () => {
  assert.equal(sharedSentence({ title: "Strike Bowling Leipzig", text: "https://strike.example", url: "https://strike.example" }), "Strike Bowling Leipzig");
  assert.equal(sharedSentence({ title: "", text: "", url: "https://example.com" }), "");
  assert.equal(sharedSentence({}), "");
  assert.equal(sharedSentence({ text: "   \n  " }), "");
  assert.equal(sharedSentence({ text: "[19.10.26, 21:04] Carol: https://example.com" }), "");
});

test("höchstens 200 Zeichen, an einer Wortgrenze, ohne Komma am Ende", () => {
  const long = Array.from({ length: 60 }, (_, i) => `wort${i},`).join(" ");
  const r = sharedSentence({ text: long });
  assert.ok(r.length <= MAX_SENTENCE, `${r.length}`);
  assert.ok(!/[,\s]$/.test(r));
  assert.ok(long.startsWith(r));
  const noSpace = "x".repeat(500);
  assert.equal(sharedSentence({ text: noSpace }).length, MAX_SENTENCE);
});

test("aus der Adresse des Teilen-Ziels", () => {
  const search = `?title=&text=${encodeURIComponent("[19.10.26, 21:04] Carol: minigolf oder billard, sa 19 uhr https://x.example")}&url=`;
  assert.equal(sharedSentenceFromSearch(search), "minigolf oder billard, sa 19 uhr");
  assert.equal(sharedSentenceFromSearch(""), "");
  assert.equal(sharedSentenceFromSearch("?text=kino%20%2B%20pizza"), "kino + pizza");
});

test("der bereinigte Satz ergibt dieselbe Abstimmung wie getippt", () => {
  const now = new Date("2026-10-19T18:00:00Z");
  const shared = parseQuickPoll(sharedSentence({ text: "[19.10.26, 21:04] Carol: bowling oder kino, fr oder sa, 20 uhr https://x.example" }), now);
  const typed = parseQuickPoll("bowling oder kino, fr oder sa, 20 uhr", now);
  assert.deepEqual(shared.options, typed.options);
  assert.equal(shared.options.length, 4);
  assert.ok(!shared.activities.some((a) => /carol|http/i.test(a)), "kein Name und kein Link als Vorschlag");
});
