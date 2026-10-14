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
