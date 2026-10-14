// Zuletzt in Discover gewählte Stadt – nur eine Bequemlichkeit in diesem Browser, nie an den Server.
const CITY_KEY = "afterhours.discover.city";

export function rememberedCity(): string | null {
  try {
    return window.localStorage.getItem(CITY_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function rememberCity(city: string) {
  try {
    window.localStorage.setItem(CITY_KEY, city);
  } catch {
    // Speicher gesperrt (privater Modus o. Ä.) – dann eben ohne.
  }
}
