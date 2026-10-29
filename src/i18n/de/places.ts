/**
 * P11 Etappe 2f: Beschreibung von Orten aus OpenStreetMap (wie `describe` in supabase/functions/places/osm.ts).
 * Eigene Datei außerhalb des Start-Wörterbuchs: nur die Seite eines Ortes braucht sie (eigener Chunk).
 */
export const places = {
  cuisine: (list: string) => `Küche: ${list}.`,
  cuisines: {
    italian: "Italienisch", pizza: "Pizza", german: "Deutsch", regional: "Regional", bavarian: "Bayerisch",
    asian: "Asiatisch", chinese: "Chinesisch", japanese: "Japanisch", sushi: "Sushi", vietnamese: "Vietnamesisch",
    thai: "Thailändisch", indian: "Indisch", turkish: "Türkisch", kebab: "Döner/Kebab", greek: "Griechisch",
    burger: "Burger", mexican: "Mexikanisch", spanish: "Spanisch", tapas: "Tapas", french: "Französisch",
    american: "Amerikanisch", steak_house: "Steakhaus", korean: "Koreanisch", lebanese: "Libanesisch",
    arab: "Arabisch", syrian: "Syrisch", persian: "Persisch", ethiopian: "Äthiopisch", african: "Afrikanisch",
    seafood: "Fisch & Meeresfrüchte", fish: "Fisch", coffee_shop: "Kaffee", cake: "Kuchen", ice_cream: "Eis",
    breakfast: "Frühstück", bagel: "Bagels", noodle: "Nudeln", ramen: "Ramen", balkan: "Balkan", polish: "Polnisch",
    russian: "Russisch", portuguese: "Portugiesisch", georgian: "Georgisch", austrian: "Österreichisch",
    mediterranean: "Mediterran", international: "International", vegan: "Vegan", vegetarian: "Vegetarisch",
    falafel: "Falafel", sandwich: "Sandwiches", crepe: "Crêpes", waffle: "Waffeln", brunch: "Brunch",
  },
  sports: { climbing: "Klettern/Bouldern", trampoline: "Trampolin", swimming: "Schwimmen", ice_skating: "Eislaufen" },
  veganOnly: "Rein vegan.",
  veganYes: "Vegane Gerichte.",
  outdoorSeating: "Außenplätze.",
  wheelchairYes: "Rollstuhlgerecht.",
  wheelchairLimited: "Eingeschränkt rollstuhlgerecht.",
};
