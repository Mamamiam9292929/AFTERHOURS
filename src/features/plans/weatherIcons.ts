import {
  IconWeatherClear,
  IconWeatherCloudy,
  IconWeatherDrizzle,
  IconWeatherFog,
  IconWeatherPartly,
  IconWeatherRain,
  IconWeatherSnow,
  IconWeatherThunder,
  IconWeatherUnknown,
} from "@/components/icons";
import type { WeatherKind } from "@/lib/weather";

/** Symbol je Wetterlage – auch für das Wetter in Abstimmungen (P5 Etappe 2). */
export const WEATHER_ICONS: Record<WeatherKind, typeof IconWeatherClear> = {
  clear: IconWeatherClear,
  partly: IconWeatherPartly,
  cloudy: IconWeatherCloudy,
  fog: IconWeatherFog,
  drizzle: IconWeatherDrizzle,
  rain: IconWeatherRain,
  freezing: IconWeatherSnow,
  snow: IconWeatherSnow,
  showers: IconWeatherRain,
  thunder: IconWeatherThunder,
  unknown: IconWeatherUnknown,
};

