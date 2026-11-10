/**
 * P36 · „Wer fährt?“ – wer sitzt in welchem Auto, und wer hat noch keinen Platz?
 *
 * Bisher sah nur die fahrende Person, wen sie mitnimmt; alle anderen sahen Punkte. Im Gruppenchat geht dann trotzdem
 * die Frage „wer fährt bei wem?“ rum. Hier steht es für die ganze Crew am Plan: bestätigte Mitfahrende je Auto und
 * „Noch ohne Platz im Auto“ – alle mit „Bin dabei“ oder „Vielleicht“, die weder fahren noch bestätigt mitfahren.
 * Das ist eine Feststellung, keine Behauptung, dass jemand eine Fahrt braucht (wer mit der Bahn kommt, steht auch da).
 *
 * Bewusst ohne Importe: Die Datei läuft unverändert im Unit-Test (`node --test`, Typen werden entfernt).
 */
export interface RideRequestLike {
  passenger_user_id: string;
  status: string;
  seats_requested: number;
}

export interface RideOfferLike {
  id: string;
  driver_user_id: string;
  status: string;
  available_seats: number;
  requests: RideRequestLike[];
}

export interface ParticipantLike {
  user_id: string;
  attendance_status: string;
  waitlisted_at?: string | null;
}

/** Bestätigte Mitfahrende eines Autos, in der Reihenfolge der Anfragen. */
export function ridePassengers(offer: RideOfferLike): string[] {
  return offer.requests.filter((r) => r.status === "accepted").map((r) => r.passenger_user_id);
}

/** Freie Plätze eines Autos (nie unter null). */
export function rideFreeSeats(offer: RideOfferLike): number {
  const taken = offer.requests.filter((r) => r.status === "accepted").reduce((sum, r) => sum + r.seats_requested, 0);
  return Math.max(0, offer.available_seats - taken);
}

/**
 * Wer kommt (dabei oder vielleicht, nicht auf der Nachrückliste), fährt aber weder selbst noch bestätigt mit?
 * Leer, solange niemand eine Fahrt anbietet – dann ist die Frage im Raum noch gar nicht gestellt.
 */
export function withoutRide(offers: RideOfferLike[], participants: ParticipantLike[]): string[] {
  const open = offers.filter((o) => o.status === "open");
  if (open.length === 0) return [];
  const seated = new Set<string>();
  for (const offer of open) {
    seated.add(offer.driver_user_id);
    for (const passenger of ridePassengers(offer)) seated.add(passenger);
  }
  return participants
    .filter((p) => (p.attendance_status === "going" || p.attendance_status === "maybe") && !p.waitlisted_at && !seated.has(p.user_id))
    .sort((a, b) => (a.attendance_status === b.attendance_status ? 0 : a.attendance_status === "going" ? -1 : 1))
    .map((p) => p.user_id);
}

/** Wer abgesagt hat, bietet keine Fahrt an und fragt keine an (der Server prüft das auch). */
export function canRide(participants: ParticipantLike[], userId: string): boolean {
  return participants.find((p) => p.user_id === userId)?.attendance_status !== "declined";
}
