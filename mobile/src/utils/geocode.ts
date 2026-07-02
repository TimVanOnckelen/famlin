// Nominatim (OpenStreetMap) reverse geocoding — free, no API key, used sparingly
// (only when the user drops or moves a pin), per Nominatim's usage policy which
// requires a descriptive User-Agent header.
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=16`,
      { headers: { 'User-Agent': 'FamlinApp (self-hosted family app)' } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return data?.display_name || null;
  } catch {
    return null;
  }
}
