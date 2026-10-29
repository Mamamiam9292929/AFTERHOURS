/** P11 Etappe 2f: Beschreibung von Orten aus OpenStreetMap – Gegenstück zu src/i18n/de/places.ts. */
import type { places as dePlaces } from "../de/places";

export const places = {
  cuisine: (list: string) => `Cuisine: ${list}.`,
  cuisines: {
    italian: "Italian", pizza: "Pizza", german: "German", regional: "Regional", bavarian: "Bavarian",
    asian: "Asian", chinese: "Chinese", japanese: "Japanese", sushi: "Sushi", vietnamese: "Vietnamese",
    thai: "Thai", indian: "Indian", turkish: "Turkish", kebab: "Doner kebab", greek: "Greek",
    burger: "Burgers", mexican: "Mexican", spanish: "Spanish", tapas: "Tapas", french: "French",
    american: "American", steak_house: "Steakhouse", korean: "Korean", lebanese: "Lebanese",
    arab: "Arabic", syrian: "Syrian", persian: "Persian", ethiopian: "Ethiopian", african: "African",
    seafood: "Fish & seafood", fish: "Fish", coffee_shop: "Coffee", cake: "Cake", ice_cream: "Ice cream",
    breakfast: "Breakfast", bagel: "Bagels", noodle: "Noodles", ramen: "Ramen", balkan: "Balkan", polish: "Polish",
    russian: "Russian", portuguese: "Portuguese", georgian: "Georgian", austrian: "Austrian",
    mediterranean: "Mediterranean", international: "International", vegan: "Vegan", vegetarian: "Vegetarian",
    falafel: "Falafel", sandwich: "Sandwiches", crepe: "Crêpes", waffle: "Waffles", brunch: "Brunch",
  },
  sports: { climbing: "Climbing/bouldering", trampoline: "Trampolining", swimming: "Swimming", ice_skating: "Ice skating" },
  veganOnly: "Fully vegan.",
  veganYes: "Vegan dishes.",
  outdoorSeating: "Outdoor seating.",
  wheelchairYes: "Wheelchair accessible.",
  wheelchairLimited: "Partly wheelchair accessible.",
} satisfies typeof dePlaces;
