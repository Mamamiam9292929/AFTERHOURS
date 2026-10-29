// W2 · Messenger-Vorschau (api/share.js): Texte, Escaping, Einbau in die App-Hülle, Verhalten bei Fehlern.
// Läuft ohne Netz: node --test tests/unit/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { describeSharedPlan, describeSharedPoll, escapeHtml, formatWhen, injectMeta, shareMetaTags } from "../../api/_lib/share-card.js";
import { handleShare } from "../../api/share.js";

const TOKEN = "0123456789abcdef0123456789abcdef";
const shell = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const valid = (plan) => ({ status: "valid", plan_id: null, plan: { title: "Bowling", starts_at: "2026-10-16T18:00:00Z", ends_at: null, status: "confirmed", going_count: 3, ...plan } });

test("Zeit in Berliner Zeit, ausgeschrieben", () => {
  assert.equal(formatWhen("2026-10-16T18:00:00Z"), "Freitag, 16. Oktober · 20:00 Uhr");
  assert.equal(formatWhen("2026-12-24T19:30:00Z"), "Donnerstag, 24. Dezember · 20:30 Uhr", "Winterzeit");
});

test("Texte je nach Stand des Plans", () => {
  assert.deepEqual(describeSharedPlan(valid({})), { title: "Bowling · AFTERHOURS", description: "Freitag, 16. Oktober · 20:00 Uhr · 3 sind dabei. Bist du dabei?" });
  assert.match(describeSharedPlan(valid({ going_count: 1 })).description, /· 1 ist dabei\./);
  assert.match(describeSharedPlan(valid({ going_count: 0 })).description, /· Noch keine Zusage\./);
  assert.match(describeSharedPlan(valid({ status: "cancelled" })).description, /^Abgesagt – war geplant für Freitag/);
  assert.match(describeSharedPlan(valid({ status: "completed" })).description, /^Vorbei/);
  for (const preview of [{ status: "not_found" }, { status: "expired" }, null, { status: "valid" }]) {
    assert.equal(describeSharedPlan(preview).title, "AFTERHOURS", `allgemeine Vorschau für ${JSON.stringify(preview)}`);
  }
});

test("Escaping: ein Titel kann kein HTML einschleusen", () => {
  assert.equal(escapeHtml(`"><script>alert('x')</script>&`), "&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;");
  const tags = shareMetaTags({ title: `Bar "Zur Post" <b>`, description: "x", url: "https://a.test/s/1", image: "https://a.test/og/plan.png" });
  assert.ok(!tags.includes("<b>"));
  assert.ok(tags.includes('content="Bar &quot;Zur Post&quot; &lt;b&gt;"'));
});

test("Einbau in index.html: ein Titel, eine Beschreibung, Skript bleibt", () => {
  const tags = shareMetaTags({ title: "Bowling · AFTERHOURS", description: "Beschreibung", url: "https://a.test/s/1", image: "https://a.test/og/plan.png" });
  const html = injectMeta(shell, tags);
  assert.equal(html.match(/<title>/g)?.length, 1);
  assert.equal(html.match(/name="description"/g)?.length, 1);
  assert.ok(html.includes("<title>Bowling · AFTERHOURS</title>"));
  assert.ok(html.includes('<meta property="og:image" content="https://a.test/og/plan.png" />'));
  assert.ok(html.includes('<div id="root"></div>'), "die App lädt weiterhin");
  assert.ok(html.indexOf("og:title") < html.indexOf("</head>"));
});

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const route = routes.find(([prefix]) => String(url).startsWith(prefix));
    if (!route) throw new Error(`unerwartet: ${url}`);
    const [, status, body] = route;
    if (status === "fail") throw new Error("Netz weg");
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return Object.assign(impl, { calls });
}

const env = { VITE_SUPABASE_URL: "https://db.test", VITE_SUPABASE_ANON_KEY: "eyJ.anon", VITE_SITE_URL: "https://afterhours.test/" };

test("Handler: Vorschau mit Plan, anon-Key, absolute Bildadresse", async () => {
  const fetchImpl = fakeFetch([["https://app.test/index.html", 200, shell], ["https://db.test/rest/v1/rpc/preview_shared_plan", 200, valid({})]]);
  const response = await handleShare(new Request(`https://app.test/api/share?token=${TOKEN}`), env, fetchImpl);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.ok(html.includes('<meta property="og:title" content="Bowling · AFTERHOURS" />'));
  assert.ok(html.includes(`<meta property="og:url" content="https://afterhours.test/s/${TOKEN}" />`));
  assert.ok(html.includes('content="https://afterhours.test/og/plan.png"'));
  const rpc = fetchImpl.calls.find((c) => c.url.includes("/rpc/"));
  assert.deepEqual(JSON.parse(rpc.init.body), { p_token: TOKEN });
  assert.equal(rpc.init.headers.apikey, "eyJ.anon");
  assert.equal(rpc.init.headers.Authorization, "Bearer eyJ.anon");
});

test("Handler: Token auch aus dem Pfad, publishable key ohne Authorization", async () => {
  const fetchImpl = fakeFetch([["https://app.test/index.html", 200, shell], ["https://db.test/", 200, valid({})]]);
  await handleShare(new Request(`https://app.test/s/${TOKEN}`), { ...env, VITE_SUPABASE_ANON_KEY: "sb_publishable_x" }, fetchImpl);
  const rpc = fetchImpl.calls.find((c) => c.url.includes("/rpc/"));
  assert.equal(rpc.init.headers.Authorization, undefined);
});

test("Handler: ungültiger Token fragt die Datenbank gar nicht", async () => {
  const fetchImpl = fakeFetch([["https://app.test/index.html", 200, shell]]);
  const html = await (await handleShare(new Request("https://app.test/api/share?token=%22%3E%3Cscript%3E"), env, fetchImpl)).text();
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(html.includes("<title>AFTERHOURS</title>"));
  assert.ok(!html.includes("<script>"));
});

test("Handler: Datenbank weg oder Rate Limit → allgemeine Vorschau; Hülle weg → Notbehelf", async () => {
  for (const status of [500, "fail"]) {
    const fetchImpl = fakeFetch([["https://app.test/index.html", 200, shell], ["https://db.test/", status, { message: "rate_limited" }]]);
    const html = await (await handleShare(new Request(`https://app.test/s/${TOKEN}`), env, fetchImpl)).text();
    assert.ok(html.includes("<title>AFTERHOURS</title>"), `Status ${status}`);
  }
  const fetchImpl = fakeFetch([["https://app.test/index.html", "fail"], ["https://db.test/", 200, valid({})]]);
  const html = await (await handleShare(new Request(`https://app.test/s/${TOKEN}`), env, fetchImpl)).text();
  assert.ok(html.includes("og:title") && html.includes(`href="https://afterhours.test/s/${TOKEN}"`));
});

// ---- W2 Etappe 2 · Abstimmungen (/v/<token>) ---------------------------------------------------------
const validPoll = (poll) => ({ status: "valid", poll_id: null, poll: { title: "Was machen wir am Samstag?", ends_at: "2026-10-16T18:00:00Z", status: "open", option_count: 3, voter_count: 2, ...poll } });

test("Abstimmung: Texte je nach Stand", () => {
  assert.deepEqual(describeSharedPoll(validPoll({})), {
    title: "Was machen wir am Samstag? · AFTERHOURS",
    description: "3 Vorschläge · 2 haben abgestimmt · Abstimmen bis Freitag, 16. Oktober · 20:00 Uhr. Stimmst du mit ab?",
  });
  assert.match(describeSharedPoll(validPoll({ option_count: 1, voter_count: 1 })).description, /^1 Vorschlag · 1 hat abgestimmt · /);
  assert.match(describeSharedPoll(validPoll({ voter_count: 0 })).description, /· Noch keine Stimme ·/);
  assert.match(describeSharedPoll(validPoll({ status: "closed", voter_count: 4 })).description, /^Entschieden – 4 haben abgestimmt\./);
  assert.match(describeSharedPoll(validPoll({ guests: true })).description, /Stimmst du mit ab\? Geht auch ohne Konto\.$/, "W3: Gäste dürfen mitstimmen");
  assert.match(describeSharedPoll(validPoll({ guests: false })).description, /Stimmst du mit ab\?$/);
  for (const preview of [{ status: "not_found" }, { status: "expired" }, null, { status: "valid" }, valid({})]) {
    assert.equal(describeSharedPoll(preview).title, "AFTERHOURS", `allgemeine Vorschau für ${JSON.stringify(preview)}`);
  }
});

test("P1 Etappe 2: Termin-Abstimmung zeigt die Termine und fragt „Wann kannst du?“", () => {
  const dates = [
    { date: "2026-10-23", time: "19:00" },
    { date: "2026-10-24", time: null },
    { date: "2026-10-30", time: "20:30" },
  ];
  assert.deepEqual(describeSharedPoll(validPoll({ kind: "date", title: "Wann könnt ihr?", dates })), {
    title: "Wann könnt ihr? · AFTERHOURS",
    description: "3 Termine zur Wahl: Fr 23.10. 19:00, Sa 24.10., Fr 30.10. 20:30 · 2 haben abgestimmt · Abstimmen bis Freitag, 16. Oktober · 20:00 Uhr. Wann kannst du?",
  });
  assert.match(describeSharedPoll(validPoll({ kind: "date", dates, guests: true })).description, /Wann kannst du\? Geht auch ohne Konto\.$/);
  const many = Array.from({ length: 6 }, (_, i) => ({ date: `2026-11-0${i + 1}`, time: null }));
  assert.match(describeSharedPoll(validPoll({ kind: "date", option_count: 6, dates: many })).description, /^6 Termine zur Wahl: So 01\.11\., Mo 02\.11\., Di 03\.11\., Mi 04\.11\. und 2 weitere · /);
  assert.match(describeSharedPoll(validPoll({ kind: "date", option_count: 5, dates: many.slice(0, 5) })).description, /Mi 04\.11\. und 1 weiterer · /);
  assert.match(describeSharedPoll(validPoll({ kind: "date", option_count: 2 })).description, /^2 Termine · /, "ohne Termine (alter Server): nur die Zahl");
  assert.match(describeSharedPoll(validPoll({ kind: "date", dates: [{ date: "<script>", time: "x" }] })).description, /^3 Termine · /, "Unbrauchbares fällt weg");
  assert.match(describeSharedPoll(validPoll({ kind: "date", dates, status: "closed" })).description, /^Entschieden – /);
  assert.match(describeSharedPoll(validPoll({ kind: "place", dates })).description, /^3 Vorschläge · /, "Orts-Abstimmung: keine Termine");
});

test("Handler: Abstimmung über ?kind=poll – eigene Funktion, eigener Link, eigenes Bild", async () => {
  const fetchImpl = fakeFetch([["https://app.test/index.html", 200, shell], ["https://db.test/rest/v1/rpc/preview_shared_poll", 200, validPoll({})]]);
  const html = await (await handleShare(new Request(`https://app.test/api/share?kind=poll&token=${TOKEN}`), env, fetchImpl)).text();
  assert.ok(html.includes('<meta property="og:title" content="Was machen wir am Samstag? · AFTERHOURS" />'));
  assert.ok(html.includes(`<meta property="og:url" content="https://afterhours.test/v/${TOKEN}" />`));
  assert.ok(html.includes('content="https://afterhours.test/og/poll.png"'));
  assert.ok(html.includes('content="AFTERHOURS – eine Abstimmung eurer Crew"'));
  assert.ok(!fetchImpl.calls.some((c) => c.url.includes("preview_shared_plan")), "fragt nicht nach einem Plan");
});

test("Handler: Abstimmung auch aus dem Pfad /v/<token>; Plan-Pfad bleibt Plan", async () => {
  const pollFetch = fakeFetch([["https://app.test/index.html", 200, shell], ["https://db.test/rest/v1/rpc/preview_shared_poll", 200, validPoll({})]]);
  await handleShare(new Request(`https://app.test/v/${TOKEN}`), env, pollFetch);
  assert.ok(pollFetch.calls.some((c) => c.url.endsWith("/rpc/preview_shared_poll")));
  const planFetch = fakeFetch([["https://app.test/index.html", 200, shell], ["https://db.test/rest/v1/rpc/preview_shared_plan", 200, valid({})]]);
  const html = await (await handleShare(new Request(`https://app.test/s/${TOKEN}`), env, planFetch)).text();
  assert.ok(html.includes('content="https://afterhours.test/og/plan.png"') && html.includes(`/s/${TOKEN}"`));
});

test("Handler: Abstimmungs-Vorschau escaped die Frage", async () => {
  const fetchImpl = fakeFetch([["https://app.test/index.html", 200, shell], ["https://db.test/", 200, validPoll({ title: `"><script>x</script>` })]]);
  const html = await (await handleShare(new Request(`https://app.test/v/${TOKEN}`), env, fetchImpl)).text();
  assert.ok(!html.includes("<script>x</script>"));
});

// ---- P11 Etappe 2b · Vorschau auf Englisch (?lang=en) ----------------------------------------------------
test("Englisch: Plan-Vorschau, Zeit britisch in Berliner Zeit", () => {
  assert.equal(formatWhen("2026-10-16T18:00:00Z", "en"), "Friday 16 October · 20:00");
  assert.equal(formatWhen("2026-12-24T19:30:00Z", "en"), "Thursday 24 December · 20:30", "Winterzeit");
  assert.deepEqual(describeSharedPlan(valid({}), "en"), { title: "Bowling · AFTERHOURS", description: "Friday 16 October · 20:00 · 3 are in. Are you in?" });
  assert.match(describeSharedPlan(valid({ going_count: 1 }), "en").description, /· 1 is in\./);
  assert.match(describeSharedPlan(valid({ going_count: 0 }), "en").description, /· No one's in yet\./);
  assert.match(describeSharedPlan(valid({ status: "cancelled" }), "en").description, /^Cancelled – was planned for Friday/);
  assert.match(describeSharedPlan(valid({ status: "completed" }), "en").description, /^Over – that was Friday/);
  assert.match(describeSharedPlan(null, "en").description, /^Vote with your crew/);
});

test("Englisch: Abstimmung und Termin-Abstimmung", () => {
  assert.equal(describeSharedPoll(validPoll({}), "en").description, "3 options · 2 have voted · Vote until Friday 16 October · 20:00. Will you vote?");
  assert.match(describeSharedPoll(validPoll({ option_count: 1, voter_count: 1, guests: true }), "en").description, /^1 option · 1 has voted · .* Will you vote\? No account needed\.$/);
  assert.match(describeSharedPoll(validPoll({ voter_count: 0 }), "en").description, /· No votes yet ·/);
  assert.match(describeSharedPoll(validPoll({ status: "closed", voter_count: 4 }), "en").description, /^Decided – 4 people voted\./);
  const dates = [{ date: "2026-10-23", time: "19:00" }, { date: "2026-10-24", time: null }];
  assert.match(describeSharedPoll(validPoll({ kind: "date", option_count: 2, dates }), "en").description, /^2 dates to choose from: Fri 23 Oct 19:00, Sat 24 Oct · .*When can you make it\?$/);
  const many = Array.from({ length: 6 }, (_, i) => ({ date: `2026-11-0${i + 1}`, time: null }));
  assert.match(describeSharedPoll(validPoll({ kind: "date", option_count: 6, dates: many }), "en").description, /Wed 4 Nov and 2 more · /);
  for (const text of [describeSharedPoll(validPoll({ kind: "date", dates }), "en").description, describeSharedPlan(valid({}), "en").description]) {
    assert.doesNotMatch(text, /Uhr|Vorschl|Termin|abgestimmt|dabei|Freitag/, `ohne Deutsch: ${text}`);
  }
});

test("Sprache: unbekannt → Deutsch", () => {
  for (const locale of [undefined, null, "", "fr", "EN", "<b>"]) {
    assert.match(describeSharedPlan(valid({}), locale).description, /Bist du dabei\?$/);
  }
});

test("Handler: ?lang=en → englische Vorschau, og:locale en_GB, Sprache bleibt in og:url", async () => {
  const fetchImpl = fakeFetch([["https://app.test/index.html", 200, shell], ["https://db.test/rest/v1/rpc/preview_shared_plan", 200, valid({})]]);
  const html = await (await handleShare(new Request(`https://app.test/api/share?token=${TOKEN}&lang=en`), env, fetchImpl)).text();
  const head = html.split("</head>")[0];
  assert.ok(head.includes('<meta property="og:locale" content="en_GB" />'));
  assert.ok(head.includes('<meta property="og:description" content="Friday 16 October · 20:00 · 3 are in. Are you in?" />'));
  assert.ok(head.includes(`<meta property="og:url" content="https://afterhours.test/s/${TOKEN}?lang=en" />`));
  assert.ok(head.includes('content="AFTERHOURS – a ticket for your next night out"'));
  const poll = fakeFetch([["https://app.test/index.html", 200, shell], ["https://db.test/rest/v1/rpc/preview_shared_poll", 200, validPoll({})]]);
  const pollHead = (await (await handleShare(new Request(`https://app.test/v/${TOKEN}?lang=en`), env, poll)).text()).split("</head>")[0];
  assert.ok(pollHead.includes("Will you vote?") && pollHead.includes(`/v/${TOKEN}?lang=en"`) && pollHead.includes("a poll by your crew"));
  const offline = fakeFetch([["https://app.test/index.html", 500, ""], ["https://db.test/rest/v1/rpc/preview_shared_plan", 200, valid({})]]);
  const fallback = await (await handleShare(new Request(`https://app.test/s/${TOKEN}?lang=en`), env, offline)).text();
  assert.ok(fallback.includes('<html lang="en">') && fallback.includes("Open AFTERHOURS"));
  const german = await (await handleShare(new Request(`https://app.test/s/${TOKEN}?lang=xx`), env, fakeFetch([["https://app.test/index.html", 200, shell], ["https://db.test/rest/v1/rpc/preview_shared_plan", 200, valid({})]]))).text();
  assert.ok(german.includes('content="de_DE"') && german.includes(`/s/${TOKEN}" />`), "unbekannte Sprache: Deutsch, Link ohne Zusatz");
});
