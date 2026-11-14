// P53 · „Habt ihr alle Tickets?“ – Stand des Ticket-Checks (src/lib/tickets.ts). Server: pgTAP 95_plan_tickets, 97_plan_guest_tickets.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canSayTicket, ticketStanding } from "../../src/lib/tickets.ts";

test("Ticket-Check zählt nur Zusagen, Absagen mit Ticket stehen als „übrig“ da", () => {
  const s = ticketStanding([
    { user_id: "a", attendance_status: "going", has_ticket: true },
    { user_id: "b", attendance_status: "going", has_ticket: false },
    { user_id: "c", attendance_status: "going" },
    { user_id: "d", attendance_status: "maybe", has_ticket: true },
    { user_id: "e", attendance_status: "declined", has_ticket: true },
    { user_id: "f", attendance_status: "declined", has_ticket: false },
    { user_id: "g", attendance_status: "invited", has_ticket: null },
  ]);
  assert.equal(s.going, 3);
  assert.equal(s.have, 1);
  assert.deepEqual(s.missing, ["b", "c"], "ohne Angabe heißt: noch keins");
  assert.deepEqual(s.spare, ["e"], "nur Absagen mit Ticket – „Vielleicht“ braucht es vielleicht noch");
  assert.equal(s.complete, false);
});

test("Alle mit Ticket: komplett – aber nicht, wenn niemand zugesagt hat", () => {
  assert.equal(ticketStanding([{ user_id: "a", attendance_status: "going", has_ticket: true }]).complete, true);
  const empty = ticketStanding([{ user_id: "a", attendance_status: "invited" }]);
  assert.equal(empty.complete, false);
  assert.equal(empty.going, 0);
  assert.deepEqual(empty.missing, []);
});

test("Wer seine Angabe ändern darf", () => {
  assert.equal(canSayTicket(undefined), false, "keine Zeile im Plan");
  assert.equal(canSayTicket({ attendance_status: "going" }), true);
  assert.equal(canSayTicket({ attendance_status: "maybe", has_ticket: false }), true);
  assert.equal(canSayTicket({ attendance_status: "invited", has_ticket: false }), false, "erst antworten");
  assert.equal(canSayTicket({ attendance_status: "declined", has_ticket: false }), false);
  assert.equal(canSayTicket({ attendance_status: "declined", has_ticket: true }), true, "Ticket übrig lässt sich zurücknehmen");
});

test("Etappe 2c: Gäste über den Teilen-Link zählen mit und stehen mit Namen da", () => {
  const s = ticketStanding(
    [
      { user_id: "a", attendance_status: "going", has_ticket: true },
      { user_id: "b", attendance_status: "going", has_ticket: false },
    ],
    [
      { id: "g1", display_name: "Dana", attendance_status: "going", has_ticket: false },
      { id: "g2", display_name: "Emil", attendance_status: "going", has_ticket: true },
      { id: "g3", display_name: "Fritz", attendance_status: "declined", has_ticket: true },
      { id: "g4", display_name: "Gabi", attendance_status: "maybe", has_ticket: false },
    ],
  );
  assert.equal(s.going, 4, "zwei Mitglieder, zwei Gäste mit Zusage");
  assert.equal(s.have, 2);
  assert.deepEqual(s.missing, ["b"]);
  assert.deepEqual(s.missingGuests, ["Dana"]);
  assert.deepEqual(s.spareGuests, ["Fritz"], "Gast mit Absage und Ticket: übrig");
  assert.equal(s.complete, false);
  const done = ticketStanding([{ user_id: "a", attendance_status: "invited" }], [{ id: "g", display_name: "Emil", attendance_status: "going", has_ticket: true }]);
  assert.equal(done.complete, true, "nur ein Gast dabei, mit Ticket: komplett");
  assert.deepEqual(ticketStanding([]).missingGuests, [], "ohne Gäste leer");
});
