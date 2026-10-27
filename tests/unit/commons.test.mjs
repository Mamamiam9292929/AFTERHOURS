// P7 · Fotos von Orten über Wikimedia Commons (src/lib/commons.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BATCH_SIZE, hasPhotoRef, imageInfoBatchUrl, imageInfoUrl, loadPlacePhoto, loadPlacePhotos, newPhotoCache, normalizeFile, parseImageInfo,
  parseImageInfoBatch, parseWikidataBatch, parseWikidataImage, plainText, PhotoError, wikidataBatchUrl, wikidataUrl,
} from "../../src/lib/commons.ts";

const info = (over = {}, meta = {}) => ({
  query: {
    pages: [{
      title: "File:Moritzbastei Leipzig.jpg",
      imageinfo: [{
        thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Moritzbastei_Leipzig.jpg/960px-Moritzbastei_Leipzig.jpg",
        thumbwidth: 960, thumbheight: 640, mime: "image/jpeg",
        descriptionurl: "https://commons.wikimedia.org/wiki/File:Moritzbastei_Leipzig.jpg",
        extmetadata: {
          Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Max">Max Muster</a>' },
          LicenseShortName: { value: "CC BY-SA 4.0" },
          LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
          AttributionRequired: { value: "true" },
          ...meta,
        },
        ...over,
      }],
    }],
  },
});

test("freies Foto: Vorschaubild, Urheber als Text, Lizenz mit Link", () => {
  const photo = parseImageInfo(info());
  assert.equal(photo?.src.startsWith("https://upload.wikimedia.org/"), true);
  assert.equal(photo?.file, "Moritzbastei Leipzig.jpg");
  assert.equal(photo?.author, "Max Muster");
  assert.equal(photo?.license, "CC BY-SA 4.0");
  assert.equal(photo?.licenseUrl, "https://creativecommons.org/licenses/by-sa/4.0");
  assert.equal(photo?.pageUrl, "https://commons.wikimedia.org/wiki/File:Moritzbastei_Leipzig.jpg");
  assert.deepEqual([photo?.width, photo?.height], [960, 640]);
});

test("Lizenzen: frei ja, alles andere nein", () => {
  for (const license of ["CC0", "CC0 1.0", "CC BY 2.0", "CC BY-SA 3.0 de", "Public domain", "PD-old"]) {
    assert.notEqual(parseImageInfo(info({}, { LicenseShortName: { value: license } })), null, license);
  }
  for (const license of ["CC BY-NC 4.0", "CC BY-ND 4.0", "GFDL", "Fair use", "All rights reserved", ""]) {
    assert.equal(parseImageInfo(info({}, { LicenseShortName: { value: license } })), null, license);
  }
  // Protokoll-relative Lizenzadresse wird https.
  assert.equal(parseImageInfo(info({}, { LicenseUrl: { value: "//creativecommons.org/licenses/by/2.0" } }))?.licenseUrl, "https://creativecommons.org/licenses/by/2.0");
  assert.equal(parseImageInfo(info({}, { LicenseUrl: { value: "javascript:alert(1)" } }))?.licenseUrl, null);
});

test("ohne Urheber kein Foto, wenn die Lizenz die Nennung verlangt", () => {
  assert.equal(parseImageInfo(info({}, { Artist: { value: "" } })), null);
  assert.equal(parseImageInfo(info({}, { Artist: undefined })), null);
  const pd = parseImageInfo(info({}, { Artist: undefined, LicenseShortName: { value: "Public domain" }, AttributionRequired: { value: "false" } }));
  assert.equal(pd?.author, null);
});

test("nichts außer Commons-Adressen, Rasterbildern und Dateien; keine erkennbaren Personen", () => {
  assert.equal(parseImageInfo(info({ thumburl: "https://evil.example/x.jpg" })), null);
  assert.equal(parseImageInfo(info({ thumburl: 'https://upload.wikimedia.org/x.jpg" onerror="x' })), null);
  assert.equal(parseImageInfo(info({ descriptionurl: "https://evil.example/" })), null);
  assert.equal(parseImageInfo(info({ mime: "image/svg+xml" })), null);
  assert.equal(parseImageInfo(info({}, { Restrictions: { value: "personality" } })), null);
  assert.notEqual(parseImageInfo(info({}, { Restrictions: { value: "trademarked" } })), null);
  assert.equal(parseImageInfo({ query: { pages: [{ title: "File:Fehlt.jpg", missing: true }] } }), null);
  assert.equal(parseImageInfo(null), null);
  assert.equal(parseImageInfo({}), null);
});

test("Urheber: HTML und Entities werden reiner Text, lange Namen gekürzt", () => {
  assert.equal(plainText('<span class="x">Anna &amp; Ben</span>'), "Anna & Ben");
  assert.equal(plainText("&lt;img src=x onerror=alert(1)&gt;"), "img src=x onerror=alert(1)");
  assert.equal(plainText("A&#252;&#x00DF;"), "Aüß");
  assert.equal(plainText("  <b> </b> "), null);
  assert.equal(plainText("x".repeat(200)).length, 120);
  assert.equal(plainText(42), null);
});

test("Wikidata: bevorzugtes Bild, nie veraltet, nur Rasterbilder", () => {
  const claim = (value, rank = "normal") => ({ rank, mainsnak: { datavalue: { value } } });
  assert.equal(parseWikidataImage({ claims: { P18: [claim("A.jpg"), claim("B.jpg", "preferred")] } }), "File:B.jpg");
  assert.equal(parseWikidataImage({ claims: { P18: [claim("Alt.jpg", "deprecated"), claim("Neu_bild.png")] } }), "File:Neu bild.png");
  assert.equal(parseWikidataImage({ claims: { P18: [claim("Plan.svg")] } }), null);
  assert.equal(parseWikidataImage({ claims: {} }), null);
  assert.equal(parseWikidataImage(null), null);
});

test("Adressen: ohne Cookies abfragbar (origin=*), Datei und Kennung als Parameter", () => {
  const url = new URL(imageInfoUrl("File:A & B.jpg"));
  assert.equal(url.origin, "https://commons.wikimedia.org");
  assert.equal(url.searchParams.get("titles"), "File:A & B.jpg");
  assert.equal(url.searchParams.get("origin"), "*");
  assert.equal(new URL(wikidataUrl("Q42")).searchParams.get("entity"), "Q42");
  assert.equal(hasPhotoRef({ commons_file: null, wikidata_id: "Q1" }), true);
  assert.equal(hasPhotoRef({ commons_file: null, wikidata_id: null }), false);
});

test("Laden: Datei zuerst, dann Wikidata; Fehler sind Fehler, kein Foto ist null", async () => {
  const calls = [];
  const fake = (routes) => async (url, init) => {
    calls.push(url);
    assert.equal(init.credentials, "omit");
    assert.equal(init.referrerPolicy, "no-referrer");
    const host = new URL(url).host;
    const body = routes[host];
    if (body instanceof Error) throw body;
    if (body === 503) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => (typeof body === "function" ? body(url) : body) };
  };

  const direct = await loadPlacePhoto({ commons_file: "File:Moritzbastei Leipzig.jpg", wikidata_id: "Q1" }, fake({ "commons.wikimedia.org": info() }));
  assert.equal(direct?.author, "Max Muster");
  assert.equal(calls.length, 1, "mit Datei kein Umweg über Wikidata");

  calls.length = 0;
  const viaWikidata = await loadPlacePhoto({ commons_file: null, wikidata_id: "Q1" }, fake({
    "www.wikidata.org": { claims: { P18: [{ rank: "normal", mainsnak: { datavalue: { value: "Moritzbastei Leipzig.jpg" } } }] } },
    "commons.wikimedia.org": (url) => {
      assert.equal(new URL(url).searchParams.get("titles"), "File:Moritzbastei Leipzig.jpg");
      return info();
    },
  }));
  assert.equal(viaWikidata?.file, "Moritzbastei Leipzig.jpg");
  assert.equal(calls.length, 2);

  // Unfreie Datei → Wikidata als zweite Chance.
  calls.length = 0;
  let commonsCalls = 0;
  const second = await loadPlacePhoto({ commons_file: "File:Unfrei.jpg", wikidata_id: "Q2" }, fake({
    "www.wikidata.org": { claims: { P18: [{ rank: "normal", mainsnak: { datavalue: { value: "Frei.jpg" } } }] } },
    "commons.wikimedia.org": () => (commonsCalls++ === 0 ? info({}, { LicenseShortName: { value: "CC BY-NC 4.0" } }) : info()),
  }));
  assert.notEqual(second, null);

  assert.equal(await loadPlacePhoto({ commons_file: null, wikidata_id: "Q3" }, fake({ "www.wikidata.org": { claims: {} } })), null);
  assert.equal(await loadPlacePhoto({ commons_file: null, wikidata_id: null }, fake({})), null);
  await assert.rejects(loadPlacePhoto({ commons_file: "File:A.jpg", wikidata_id: null }, fake({ "commons.wikimedia.org": 503 })), PhotoError);
  await assert.rejects(loadPlacePhoto({ commons_file: null, wikidata_id: "Q4" }, fake({ "www.wikidata.org": new TypeError("offline") })), PhotoError);
});

// Etappe 2: Sammelabfragen für Discover.

const page = (title, meta = {}) => ({
  title,
  imageinfo: [{
    thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${encodeURIComponent(title.slice(5).replace(/ /g, "_"))}/640px-x.jpg`,
    thumbwidth: 640, thumbheight: 427, mime: "image/jpeg",
    descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    extmetadata: { Artist: { value: "Lea" }, LicenseShortName: { value: "CC BY 4.0" }, ...meta },
  }],
});

/** Nachgestellte Wikimedia-APIs: zählt Anfragen, beantwortet Sammelabfragen wie die echten. */
function fakeWikimedia({ freeFiles = [], images = {}, down = [] } = {}) {
  const calls = [];
  const fetcher = async (raw) => {
    const url = new URL(raw);
    calls.push(url);
    const json = (body) => ({ ok: true, json: async () => body });
    if (down.includes(url.host)) return { ok: false, json: async () => ({}) };
    if (url.searchParams.get("action") === "wbgetentities") {
      const entities = {};
      for (const id of url.searchParams.get("ids").split("|")) {
        entities[id] = images[id] ? { claims: { P18: [{ rank: "normal", mainsnak: { datavalue: { value: images[id] } } }] } } : { claims: {} };
      }
      return json({ entities });
    }
    const titles = url.searchParams.get("titles").split("|");
    return json({ query: { pages: titles.map((t) => (freeFiles.includes(t) ? page(t) : page(t, { LicenseShortName: { value: "All rights reserved" } }))) } });
  };
  return { calls, fetcher };
}

test("Dateinamen wie Commons: Leerzeichen, großer Anfang, „File:“", () => {
  assert.equal(normalizeFile("File:pub_18__Leipzig.jpg"), "File:Pub 18 Leipzig.jpg");
  assert.equal(normalizeFile("file:Moritzbastei.JPG"), "File:Moritzbastei.JPG");
});

test("Sammelabfrage: ein Eintrag je angefragter Datei, auch über „normalized“ und für fehlende", () => {
  const body = {
    query: {
      normalized: [{ from: "File:a_b.jpg", to: "File:A b.jpg" }],
      pages: [page("File:A b.jpg"), { title: "File:Fehlt.jpg", missing: true }, page("File:Unfrei.jpg", { LicenseShortName: { value: "Fair use" } })],
    },
  };
  const result = parseImageInfoBatch(body, ["File:a_b.jpg", "File:Fehlt.jpg", "File:Unfrei.jpg", "File:Nie gefragt.jpg"]);
  assert.equal(result.get("File:a_b.jpg")?.author, "Lea");
  assert.equal(result.get("File:Fehlt.jpg"), null);
  assert.equal(result.get("File:Unfrei.jpg"), null);
  assert.equal(result.get("File:Nie gefragt.jpg"), null);
  assert.equal(parseImageInfoBatch(null, ["File:X.jpg"]).get("File:X.jpg"), null);
});

test("Sammel-URLs: Titel bzw. Einträge mit | getrennt, kleineres Vorschaubild", () => {
  const url = new URL(imageInfoBatchUrl(["File:A.jpg", "File:B.jpg"]));
  assert.equal(url.searchParams.get("titles"), "File:A.jpg|File:B.jpg");
  assert.equal(url.searchParams.get("iiurlwidth"), "640");
  assert.equal(url.searchParams.get("origin"), "*");
  const wd = new URL(wikidataBatchUrl(["Q1", "Q2"]));
  assert.equal(wd.searchParams.get("action"), "wbgetentities");
  assert.equal(wd.searchParams.get("ids"), "Q1|Q2");
  assert.equal(wd.searchParams.get("props"), "claims");
  assert.deepEqual([...parseWikidataBatch({ entities: { Q1: { claims: { P18: [{ rank: "deprecated", mainsnak: { datavalue: { value: "Alt.jpg" } } }] } } } }, ["Q1", "Q2"])], [["Q1", null], ["Q2", null]]);
});

test("Fotos für viele Orte: Commons zuerst, Wikidata nur wo nötig, je Runde eine Anfrage", async () => {
  const { calls, fetcher } = fakeWikimedia({ freeFiles: ["File:Pub 18.jpg", "File:Kino.jpg"], images: { Q7: "Kino.jpg", Q8: "Unfrei.jpg", Q9: "Pub_18.jpg" } });
  const photos = await loadPlacePhotos([
    { id: "a", commons_file: "File:Pub_18.jpg", wikidata_id: "Q9" },
    { id: "b", commons_file: null, wikidata_id: "Q7" },
    { id: "c", commons_file: "File:Unfrei2.jpg", wikidata_id: "Q8" },
    { id: "d", commons_file: null, wikidata_id: null },
    { id: "e", commons_file: "File:Logo.svg", wikidata_id: "Q99999999999999" },
  ], fetcher, newPhotoCache());
  assert.deepEqual([...photos.keys()].sort(), ["a", "b"]);
  assert.equal(photos.get("a").file, "Pub 18.jpg");
  assert.equal(photos.get("b").file, "Kino.jpg");
  const commons = calls.filter((u) => u.host === "commons.wikimedia.org");
  const wikidata = calls.filter((u) => u.host === "www.wikidata.org");
  assert.equal(wikidata.length, 1, "eine Wikidata-Anfrage für alle Einträge");
  assert.equal(wikidata[0].searchParams.get("ids"), "Q7|Q8", "Wikidata nur für Orte ohne freies Commons-Foto");
  assert.equal(commons.length, 2, "Runde 1 (OSM-Dateien) und Runde 2 (Bilder aus Wikidata)");
  assert.equal(commons[0].searchParams.get("titles"), "File:Pub 18.jpg|File:Unfrei2.jpg");
  assert.equal(commons[1].searchParams.get("titles"), "File:Kino.jpg|File:Unfrei.jpg");
});

test("Zwischenspeicher: schon Gefragtes wird nicht noch einmal gefragt", async () => {
  const { calls, fetcher } = fakeWikimedia({ freeFiles: ["File:A.jpg"] });
  const cache = newPhotoCache();
  await loadPlacePhotos([{ id: "a", commons_file: "File:A.jpg", wikidata_id: null }], fetcher, cache);
  const again = await loadPlacePhotos([{ id: "a", commons_file: "File:A.jpg", wikidata_id: null }, { id: "b", commons_file: "File:B.jpg", wikidata_id: null }], fetcher, cache);
  assert.equal(again.size, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("titles"), "File:B.jpg");
});

test("Mehr als 50 Orte: in Teilen; fällt ein Dienst aus, fehlen nur dessen Fotos", async () => {
  const files = Array.from({ length: BATCH_SIZE + 3 }, (_, i) => `File:Ort ${i}.jpg`);
  const { calls, fetcher } = fakeWikimedia({ freeFiles: files });
  const photos = await loadPlacePhotos(files.map((f, i) => ({ id: String(i), commons_file: f, wikidata_id: null })), fetcher, newPhotoCache());
  assert.equal(photos.size, BATCH_SIZE + 3);
  assert.deepEqual(calls.map((u) => u.searchParams.get("titles").split("|").length), [BATCH_SIZE, 3]);

  const down = fakeWikimedia({ freeFiles: ["File:A.jpg"], images: { Q1: "B.jpg" }, down: ["www.wikidata.org"] });
  const cache = newPhotoCache();
  const partial = await loadPlacePhotos([{ id: "a", commons_file: "File:A.jpg", wikidata_id: null }, { id: "b", commons_file: null, wikidata_id: "Q1" }], down.fetcher, cache);
  assert.deepEqual([...partial.keys()], ["a"]);
  assert.equal(cache.wikidata.has("Q1"), false, "Ausfall wird nicht als „kein Foto“ gemerkt");
  const failing = async () => {
    throw new TypeError("offline");
  };
  assert.equal((await loadPlacePhotos([{ id: "a", commons_file: "File:A.jpg", wikidata_id: null }], failing, newPhotoCache())).size, 0);
});
