// WMO weather codes (Open-Meteo) to a small icon.
export function weatherIcon(code) {
  const c = Number(code);
  if (c === 0) return '&#9728;&#65039;';            // clear
  if (c <= 2) return '&#127780;&#65039;';            // mainly clear, partly cloudy
  if (c === 3) return '&#9729;&#65039;';             // overcast
  if (c === 45 || c === 48) return '&#127787;&#65039;'; // fog
  if (c >= 51 && c <= 67) return '&#127783;&#65039;';  // drizzle, rain
  if (c >= 71 && c <= 77) return '&#10052;&#65039;';   // snow
  if (c >= 80 && c <= 82) return '&#127782;&#65039;';  // showers
  if (c >= 85 && c <= 86) return '&#10052;&#65039;';
  if (c >= 95) return '&#9928;&#65039;';             // thunder
  return '';
}
