// P4 · Web-Push (src/lib/pushview.ts): Ziel einer Benachrichtigung und Mitteilung aus dem Inhalt eines Pushs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationTarget, pushLocale, pushView } from "../../src/lib/pushview.ts";

const POLL = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const CREW = "33333333-3333-4333-8333-333333333333";
const NOTE = "44444444-4444-4444-8444-444444444444";
const TEXTS = { fallbackTitle: "AFTERHOURS", fallbackBody: "Neues in deiner Crew", someone: "Jemand" };
// Wie t.notifications.text – nur die Arten, die der Test braucht.
const TEXT = {
  poll_created: (actor, p) => ({ title: `${actor} hat eine Abstimmung gestartet`, body: p.title ?? "" }),
  reward_earned: () => ({ title: "+10 Punkte" }),
  plan_changed: () => {
    throw new Error("kaputt");
  },
};
const textFor = (type) => (Object.prototype.hasOwnProperty.call(TEXT, type) ? TEXT[type] : undefined);

test("Ziel: immer ein Pfad der App", () => {
  assert.equal(notificationTarget({ type: "poll_created", crew_id: CREW, entity_type: "poll", related_entity_id: POLL }), `/polls/${POLL}`);
  assert.equal(notificationTarget({ type: "plan_changed", crew_id: CREW, entity_type: "plan", related_entity_id: PLAN }), `/plans/${PLAN}`);
  assert.equal(notificationTarget({ type: "plan_expense_reminder", crew_id: CREW, entity_type: "plan", related_entity_id: PLAN }), `/plans/${PLAN}#kosten`);
  assert.equal(notificationTarget({ type: "plan_day_reminder", crew_id: CREW, entity_type: "plan", related_entity_id: PLAN }), `/plans/${PLAN}`);
  assert.equal(notificationTarget({ type: "spontaneous_ask", crew_id: CREW, entity_type: "crew", related_entity_id: CREW }), "/");
  assert.equal(notificationTarget({ type: "reward_earned", crew_id: null, entity_type: "reward", related_entity_id: PLAN }), "/rewards");
  assert.equal(notificationTarget({ type: "crew_member_joined", crew_id: CREW, entity_type: null, related_entity_id: null }), `/crews/${CREW}`);
  assert.equal(notificationTarget({ type: "ride_request", crew_id: null, entity_type: "ride_offer", related_entity_id: PLAN }), null);
});

test("Push mit bekannter Art: Text wie in der App, Ziel, Zähler, Zeit", () => {
  const view = pushView(
    { v: 1, id: NOTE, type: "poll_created", actor: "Bob", crew_id: CREW, entity_type: "poll", entity_id: POLL, payload: { title: "Bowling am Freitag" }, at: "2026-10-28T19:00:00Z", unread: 3 },
    textFor,
    TEXTS,
  );
  assert.deepEqual(view, {
    title: "Bob hat eine Abstimmung gestartet",
    body: "Bowling am Freitag",
    url: `/polls/${POLL}`,
    tag: NOTE,
    badge: 3,
    timestamp: Date.parse("2026-10-28T19:00:00Z"),
  });
});

test("ohne Namen „Jemand“, ohne Text darunter leer", () => {
  const view = pushView({ type: "poll_created", actor: "  ", payload: {} }, textFor, TEXTS);
  assert.equal(view.title, "Jemand hat eine Abstimmung gestartet");
  assert.equal(view.body, "");
  assert.equal(view.url, "/notifications", "ohne Ziel zur Liste");
  const reward = pushView({ type: "reward_earned", entity_type: "reward", entity_id: PLAN }, textFor, TEXTS);
  assert.equal(reward.body, "");
  assert.equal(reward.url, "/rewards");
});

test("Unbekanntes, Kaputtes und Fremdes fällt auf einen allgemeinen Text zurück", () => {
  for (const raw of [null, "text", 42, [], {}, { type: "neu_und_unbekannt" }, { type: "toString" }, { type: "plan_changed", payload: {} }]) {
    const view = pushView(raw, textFor, TEXTS);
    assert.equal(view.title, "AFTERHOURS", JSON.stringify(raw));
    assert.equal(view.body, "Neues in deiner Crew");
    assert.equal(view.url, "/notifications");
  }
  // IDs, die keine sind, landen nie im Pfad.
  const evil = pushView({ type: "poll_created", entity_type: "poll", entity_id: "../../evil", crew_id: "//evil.example", payload: { title: "x" } }, textFor, TEXTS);
  assert.equal(evil.url, "/notifications");
  assert.equal(evil.tag, "afterhours");
  // Unsinnige Zähler und Zeiten werden ignoriert.
  const odd = pushView({ type: "poll_created", unread: -1, at: "gestern" }, textFor, TEXTS);
  assert.equal(odd.badge, null);
  assert.equal(odd.timestamp, null);
  // Payload als Liste wird wie leer behandelt.
  assert.equal(pushView({ type: "poll_created", actor: "Bob", payload: ["x"] }, textFor, TEXTS).body, "");
});

// P11 Etappe 2a: Sprache der Mitteilung.
test("Sprache: aus dem Profil, sonst die des Geräts", () => {
  assert.equal(pushLocale({ type: "poll_created", locale: "en" }, "de"), "en");
  assert.equal(pushLocale({ type: "poll_created", locale: "de" }, "en"), "de");
  for (const raw of [{ locale: null }, { locale: "fr" }, { locale: "EN" }, { locale: 1 }, {}, null, "en", undefined]) {
    assert.equal(pushLocale(raw, "en"), "en", `Gerät bei ${JSON.stringify(raw)}`);
    assert.equal(pushLocale(raw, "de"), "de");
  }
});
