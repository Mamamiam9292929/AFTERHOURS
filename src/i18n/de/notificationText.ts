/**
 * F9 · Texte der Benachrichtigungen (Liste und Push). Liegen nicht im Start-Bundle: Die Seite „Benachrichtigungen“
 * lädt sie mit `loadTexts("notificationText")`, der Service Worker bekommt sie fest in `push-texts.js`
 * (`src/push/render.ts`). Struktur-Vorlage für Englisch (`src/i18n/en/notificationText.ts`).
 */
import { formatEuro } from "@/lib/format";
import { formatDateTime, formatPlainDate, formatPlainTime, formatTime } from "@/lib/time";
import type { NotificationType } from "@/lib/types";

type Payload = Record<string, unknown>;
const str = (payload: Payload, key: string, fallback = "") => (typeof payload[key] === "string" ? (payload[key] as string) : fallback);

/** Texte für Benachrichtigungen. `actor` ist der Anzeigename der auslösenden Person (falls bekannt). */
export const notificationText: Record<NotificationType, (actor: string, payload: Payload) => { title: string; body?: string }> = {
  crew_member_joined: (actor) => ({ title: `${actor} ist deiner Crew beigetreten` }),
  crew_member_removed: (_actor, p) => ({ title: `Du wurdest aus „${str(p, "crew_name", "einer Crew")}“ entfernt` }),
  crew_role_changed: (_actor, p) => ({
    title: p.role === "owner" ? "Du bist jetzt Owner der Crew" : p.role === "admin" ? "Du bist jetzt Admin der Crew" : "Deine Rolle in der Crew wurde geändert",
    body: p.reason === "succession" ? "Der bisherige Owner hat die Crew verlassen." : undefined,
  }),
  // S5 Etappe 2 / S7: Stichwahl nach Gleichstand und neue Wochenrunde starten von selbst – ohne auslösende Person.
  poll_created: (actor, p) => ({
    title: p.repeat
      ? "Neue Runde – was geht diese Woche?"
      : p.auto && p.runoff
        ? "Gleichstand – die Stichwahl läuft"
        : p.runoff
          ? `${actor} hat eine Stichwahl gestartet`
          : `${actor} hat eine Abstimmung gestartet`,
    body: str(p, "title"),
  }),
  // P15: Endspurt ohne auslösende Person – in den letzten drei Stunden, solange die eigene Stimme fehlt.
  poll_reminder: (actor, p) => {
    // P40: „Und Sonntag?“ – jemand hat einen Termin nachgereicht; an alle, die schon abgestimmt haben.
    if (p.added && str(p, "date")) {
      const time = str(p, "time") ? `, ${formatPlainTime(str(p, "time"))}` : "";
      return { title: `${actor} schlägt noch ${formatPlainDate(str(p, "date"), "long")}${time} vor – kannst du?`, body: str(p, "title") };
    }
    // P40 Etappe 2: jemand hat einen Ort nachgereicht.
    if (p.added && str(p, "place")) return { title: `${actor} schlägt noch ${str(p, "place")} vor – bist du dabei?`, body: str(p, "title") };
    // P39: Frist verlängert – an alle, deren Stimme noch fehlt.
    if (p.extended && str(p, "ends_at")) return { title: `Verlängert bis ${formatDateTime(str(p, "ends_at"))} – deine Stimme fehlt noch`, body: str(p, "title") };
    return p.closing
      ? { title: str(p, "ends_at") ? `Endet um ${formatTime(str(p, "ends_at"))} – deine Stimme fehlt` : "Endet bald – deine Stimme fehlt", body: str(p, "title") }
      : { title: `${actor} erinnert dich an eine Abstimmung`, body: str(p, "title") };
  },
  poll_vote: (actor, p) => ({ title: p.guest ? `${str(p, "guest")} (Gast) hat abgestimmt` : `${actor} hat abgestimmt`, body: str(p, "title") }),
  poll_result: (_actor, p) => ({
    title: p.winner_title ? `Ergebnis: ${str(p, "winner_title")}` : p.is_tie ? "Abstimmung endet mit Gleichstand" : "Abstimmung ohne Zusagen beendet",
    body: str(p, "title"),
  }),
  // P8: Den nächsten Termin eines wiederkehrenden Plans legt die App selbst an – ohne auslösende Person.
  // S5: Die Abstimmung hat sich selbst entschieden – auch hier ohne auslösende Person.
  plan_created: (actor, p) =>
    p.repeat
      ? { title: "Der nächste Termin steht – bist du dabei?", body: str(p, "starts_at") ? `${str(p, "title")} · ${formatDateTime(str(p, "starts_at"))}` : str(p, "title") }
      : p.auto
        ? { title: "Entschieden – der Plan steht", body: str(p, "starts_at") ? `${str(p, "title")} · ${formatDateTime(str(p, "starts_at"))}` : str(p, "title") }
        : { title: `${actor} hat einen Plan erstellt`, body: str(p, "title") },
  plan_changed: (actor, p) => {
    // P23: verschoben und „Alle neu fragen“ – die alte Antwort gilt nicht mehr.
    if (p.asked_again) {
      return { title: `Neue Zeit: ${str(p, "title")} – bist du noch dabei?`, body: str(p, "starts_at") ? `${actor} hat verschoben auf ${formatDateTime(str(p, "starts_at"))}` : `${actor} hat den Plan verschoben` };
    }
    const labels: Record<string, string> = { starts_at: "Zeit", address: "Ort", meeting_point: "Treffpunkt", cost: "Kosten" };
    const changed = Array.isArray(p.changed) ? (p.changed as string[]).map((key) => labels[key] ?? key).join(", ") : "";
    return { title: `${actor} hat einen Plan geändert${changed ? `: ${changed}` : ""}`, body: str(p, "title") };
  },
  // P8 Etappe 2: „Diesmal aussetzen“ – der Termin fällt aus, der Stammtisch geht weiter.
  plan_cancelled: (actor, p) =>
    p.skipped
      ? {
          title: `${actor} setzt diesmal aus: ${str(p, "title")}`,
          body: str(p, "next_starts_at") ? `Nächster Termin: ${formatDateTime(str(p, "next_starts_at"))}` : "Der Stammtisch geht weiter.",
        }
      : { title: `${actor} hat einen Plan abgesagt`, body: str(p, "title") },
  plan_attendance: (actor, p) => {
    // W10: Antwort über den Teilen-Link – ohne Konto, mit dem Namen des Gastes.
    const who = p.guest ? `${str(p, "guest")} (Gast)` : actor;
    return {
      title: p.status === "going" ? `${who} ist dabei` : p.status === "maybe" ? `${who} kommt vielleicht` : `${who} hat abgesagt`,
      body: str(p, "title"),
    };
  },
  booking_status: (_actor, p) => {
    const status: Record<string, string> = { confirmed: "Reservierung bestätigt", unavailable: "Reservierung nicht möglich: nichts frei", failed: "Reservierung fehlgeschlagen", cancelled_by_user: "Reservierung storniert" };
    return { title: status[str(p, "status")] ?? "Reservierungsstand geändert", body: str(p, "title") };
  },
  ride_request: (actor, p) => ({ title: p.cancelled ? `${actor} fährt doch nicht mit` : `${actor} möchte bei dir mitfahren`, body: str(p, "title") }),
  ride_confirmed: (actor, p) => ({ title: p.accepted ? `${actor} nimmt dich mit` : `${actor} kann dich nicht mitnehmen`, body: str(p, "title") }),
  // P3: Ausgabe, an der du beteiligt bist (oder die als von dir bezahlt eingetragen wurde), und Rückzahlungen.
  plan_expense: (actor, p) => ({
    title: p.you_paid ? `${actor} hat eingetragen, dass du „${str(p, "description")}“ bezahlt hast` : `${actor} hat „${str(p, "description")}“ eingetragen`,
    body: [typeof p.share_cents === "number" ? `Dein Anteil: ${formatEuro(p.share_cents)}` : typeof p.amount_cents === "number" ? formatEuro(p.amount_cents) : "", str(p, "title")].filter(Boolean).join(" · "),
  }),
  plan_settlement: (actor, p) => {
    const amount = typeof p.amount_cents === "number" ? formatEuro(p.amount_cents) : "";
    // P3 Etappe 3c: eine Nachricht für mehrere Abende („Alles auf einmal ausgleichen“).
    if (p.bundle) {
      const count = typeof p.plan_count === "number" ? p.plan_count : 0;
      const body = [count > 0 ? `${count} Abende ausgeglichen` : "", str(p, "crew_name")].filter(Boolean).join(" · ");
      if (p.direction === "offset") return { title: `${actor} hat eure offenen Beträge verrechnet – ihr seid quitt`, body };
      return { title: p.direction === "received" ? `${actor} hat bestätigt, dass du ${amount} zurückgegeben hast` : `${actor} hat dir ${amount} auf einmal zurückgegeben`, body };
    }
    return { title: p.direction === "received" ? `${actor} hat deine Rückzahlung von ${amount} bestätigt` : `${actor} hat dir ${amount} zurückgegeben`, body: str(p, "title") };
  },
  // S4 · „Heute noch wer?“
  spontaneous_ask: (actor, p) => ({
    title: `${actor}: Heute noch wer?`,
    body: [str(p, "note"), str(p, "crew_name"), str(p, "expires_at") ? `bis ${formatTime(str(p, "expires_at"))}` : ""].filter(Boolean).join(" · "),
  }),
  spontaneous_answer: (actor, p) => ({ title: `${actor} hat Bock`, body: [str(p, "note"), str(p, "crew_name")].filter(Boolean).join(" · ") }),
  spontaneous_match: (_actor, p) => ({
    title: `Ihr seid ${typeof p.in_count === "number" ? p.in_count : "genug"} – heute geht was!`,
    body: [str(p, "note"), str(p, "crew_name")].filter(Boolean).join(" · "),
  }),
  // P3 Etappe 3b: Eine Woche nach dem Abend ist noch Geld offen – einmal, ohne auslösende Person.
  plan_expense_reminder: (_actor, p) => {
    const balance = typeof p.balance_cents === "number" ? p.balance_cents : 0;
    const title = str(p, "title", "eurem Abend");
    return balance > 0
      ? { title: `Bei „${title}“ bekommst du noch ${formatEuro(balance)}`, body: "Schon zurückbekommen? Dann tippe bei „Kosten teilen“ auf „Erledigt“." }
      : { title: `Bei „${title}“ sind von dir noch ${formatEuro(-balance)} offen`, body: "Schon erledigt? Dann tippe bei „Kosten teilen“ auf „Erledigt“." };
  },
  // P10 Etappe 2a: Ein Foto wurde gemeldet – an Organisation und Crew-Admins, ohne Namen der meldenden Person.
  plan_photo_reported: (_actor, p) => ({
    title: `Foto bei „${str(p, "title", "eurem Abend")}“ gemeldet`,
    body: p.own
      ? "Es ist dein Foto: Für die Crew ist es ausgeblendet, bis jemand anderes entscheidet. Löschen kannst du es jederzeit."
      : "Für die Crew ausgeblendet, bis du entscheidest: wieder zeigen oder löschen.",
  }),
  // P16: Am Morgen nach dem Abend einmal, ohne auslösende Person – nur „gestern“, wenn es stimmt.
  // P19: Organisator:in fragt alle ohne Antwort – mit Termin, damit man ohne Öffnen weiß, worum es geht.
  plan_reminder: (actor, p) => ({
    title: `${actor} fragt: Bist du dabei?`,
    body: str(p, "starts_at") ? `${str(p, "title")} · ${formatDateTime(str(p, "starts_at"))}` : str(p, "title"),
  }),
  // P25: Mindestzahl erreicht – einmal, ohne auslösende Person; wer noch nicht geantwortet hat, wird gefragt.
  plan_quorum: (_actor, p) => ({
    title: `Es findet statt: ${str(p, "title")}`,
    body: [typeof p.going === "number" ? `${p.going} sind dabei` : "", str(p, "starts_at") ? formatDateTime(str(p, "starts_at")) : "", p.answered === false ? "Bist du auch dabei?" : ""]
      .filter(Boolean)
      .join(" · "),
  }),
  // P26: Ein Platz wurde frei und die Person stand vorn auf der Nachrückliste – sie ist jetzt dabei.
  plan_waitlist_promoted: (_actor, p) => ({
    title: `Du bist nachgerückt: ${str(p, "title")}`,
    body: [str(p, "starts_at") ? formatDateTime(str(p, "starts_at")) : "", "Ein Platz ist frei geworden – du bist jetzt dabei."].filter(Boolean).join(" · "),
  }),
  // P20 Etappe 2: eine Woche vorher, Person = Geburtstagskind, Datum ohne Jahr als YYYY-MM-DD.
  birthday_reminder: (actor, p) => ({
    title: str(p, "date") ? `${actor} hat am ${formatPlainDate(str(p, "date"), "long")} Geburtstag` : `${actor} hat bald Geburtstag`,
    body: str(p, "crew_name") ? `Feier planen mit „${str(p, "crew_name")}“?` : "Feier planen?",
  }),
  // P16 + P29 Etappe 3 + P30: eine Erinnerung am Morgen danach – ist der Plan abgeschlossen und fehlt dein Urteil,
  // fragt sie zuerst „Wie war’s?“ (Fotos nur noch als Zusatz, wenn noch kaum welche da sind).
  plan_photo_nudge: (_actor, p) =>
    // P30: Wer organisiert, wird bei einem noch offenen Plan zuerst gefragt, ob der Abend stattfand.
    p.close === true
      ? {
          title: `${p.yesterday ? "Fand’s gestern statt" : "Fand der Abend statt"}? Mit einem Tipp abschließen`,
          body: `${str(p, "title")} · Dann fragen wir die Crew, wie’s war`,
        }
      : p.feedback === true
      ? {
          title: `Wie war${p.yesterday ? "’s gestern" : " der Abend"}? Sag’s mit einem Tipp`,
          body: `${str(p, "title")} · ${p.photos === false ? "Die Crew sieht nur die Zahlen" : "Und teilt eure Fotos mit der Crew"}`,
        }
      : { title: `Fotos ${p.yesterday ? "von gestern" : "vom Abend"}? Teilt sie mit der Crew`, body: str(p, "title") },
  // P4 Etappe 2: Am Tag des Plans einmal, ohne auslösende Person; die Frage nur, solange die Zusage fehlt.
  plan_day_reminder: (_actor, p) => ({
    title: str(p, "starts_at") ? `Heute ${formatTime(str(p, "starts_at"))}: ${str(p, "title")}` : `Heute: ${str(p, "title")}`,
    body:
      p.attendance === "going"
        ? "Du bist dabei – bis später!"
        : p.attendance === "maybe"
          ? "Du hast „vielleicht“ gesagt – bist du dabei?"
          : "Bist du dabei? Ein Tipp genügt.",
  }),
  reward_earned: (_actor, p) => ({
    title: `+${typeof p.points === "number" ? p.points : ""} Punkte`,
    body: `${p.reason === "plan_organized" ? "Für die Organisation" : "Für deine Teilnahme"}: ${str(p, "title")}`,
  }),
};
