// Where a family member lives, as coordinates - because Choghadiya is a
// property of a PLACE, not of a country. Free text is matched loosely so
// "New Delhi", "delhi" and "Delhi, India" all land in the same spot.
// No dependency, no network, no key: a lookup table is testable and never
// rate-limits a family at six in the morning.
export const CITIES = {
  // India
  'delhi': [28.6139, 77.2090, 'Asia/Kolkata'],      'new delhi': [28.6139, 77.2090, 'Asia/Kolkata'],
  'gurgaon': [28.4595, 77.0266, 'Asia/Kolkata'],    'gurugram': [28.4595, 77.0266, 'Asia/Kolkata'],
  'noida': [28.5355, 77.3910, 'Asia/Kolkata'],      'faridabad': [28.4089, 77.3178, 'Asia/Kolkata'],
  'mumbai': [19.0760, 72.8777, 'Asia/Kolkata'],     'bombay': [19.0760, 72.8777, 'Asia/Kolkata'],
  'thane': [19.2183, 72.9781, 'Asia/Kolkata'],      'navi mumbai': [19.0330, 73.0297, 'Asia/Kolkata'],
  'pune': [18.5204, 73.8567, 'Asia/Kolkata'],       'nagpur': [21.1458, 79.0882, 'Asia/Kolkata'],
  'bangalore': [12.9716, 77.5946, 'Asia/Kolkata'],  'bengaluru': [12.9716, 77.5946, 'Asia/Kolkata'],
  'chennai': [13.0827, 80.2707, 'Asia/Kolkata'],    'madras': [13.0827, 80.2707, 'Asia/Kolkata'],
  'hyderabad': [17.3850, 78.4867, 'Asia/Kolkata'],  'kolkata': [22.5726, 88.3639, 'Asia/Kolkata'],
  'calcutta': [22.5726, 88.3639, 'Asia/Kolkata'],   'ahmedabad': [23.0225, 72.5714, 'Asia/Kolkata'],
  'surat': [21.1702, 72.8311, 'Asia/Kolkata'],      'vadodara': [22.3072, 73.1812, 'Asia/Kolkata'],
  'jaipur': [26.9124, 75.7873, 'Asia/Kolkata'],     'lucknow': [26.8467, 80.9462, 'Asia/Kolkata'],
  'kanpur': [26.4499, 80.3319, 'Asia/Kolkata'],     'indore': [22.7196, 75.8577, 'Asia/Kolkata'],
  'bhopal': [23.2599, 77.4126, 'Asia/Kolkata'],     'patna': [25.5941, 85.1376, 'Asia/Kolkata'],
  'chandigarh': [30.7333, 76.7794, 'Asia/Kolkata'], 'ludhiana': [30.9010, 75.8573, 'Asia/Kolkata'],
  'amritsar': [31.6340, 74.8723, 'Asia/Kolkata'],   'dehradun': [30.3165, 78.0322, 'Asia/Kolkata'],
  'kochi': [9.9312, 76.2673, 'Asia/Kolkata'],       'cochin': [9.9312, 76.2673, 'Asia/Kolkata'],
  'thiruvananthapuram': [8.5241, 76.9366, 'Asia/Kolkata'], 'coimbatore': [11.0168, 76.9558, 'Asia/Kolkata'],
  'visakhapatnam': [17.6868, 83.2185, 'Asia/Kolkata'], 'bhubaneswar': [20.2961, 85.8245, 'Asia/Kolkata'],
  'guwahati': [26.1445, 91.7362, 'Asia/Kolkata'],   'varanasi': [25.3176, 82.9739, 'Asia/Kolkata'],
  'agra': [27.1767, 78.0081, 'Asia/Kolkata'],       'nashik': [19.9975, 73.7898, 'Asia/Kolkata'],
  'rajkot': [22.3039, 70.8022, 'Asia/Kolkata'],     'jodhpur': [26.2389, 73.0243, 'Asia/Kolkata'],
  'mysore': [12.2958, 76.6394, 'Asia/Kolkata'],     'mysuru': [12.2958, 76.6394, 'Asia/Kolkata'],
  'shimla': [31.1048, 77.1734, 'Asia/Kolkata'],     'goa': [15.2993, 74.1240, 'Asia/Kolkata'],
  // where the children live
  'london': [51.5074, -0.1278, 'Europe/London'],    'manchester': [53.4808, -2.2426, 'Europe/London'],
  'birmingham': [52.4862, -1.8904, 'Europe/London'],'edinburgh': [55.9533, -3.1883, 'Europe/London'],
  'dubai': [25.2048, 55.2708, 'Asia/Dubai'],        'abu dhabi': [24.4539, 54.3773, 'Asia/Dubai'],
  'sharjah': [25.3463, 55.4209, 'Asia/Dubai'],      'doha': [25.2854, 51.5310, 'Asia/Qatar'],
  'singapore': [1.3521, 103.8198, 'Asia/Singapore'],'hong kong': [22.3193, 114.1694, 'Asia/Hong_Kong'],
  'sydney': [-33.8688, 151.2093, 'Australia/Sydney'], 'melbourne': [-37.8136, 144.9631, 'Australia/Melbourne'],
  'perth': [-31.9505, 115.8605, 'Australia/Perth'], 'auckland': [-36.8485, 174.7633, 'Pacific/Auckland'],
  'toronto': [43.6532, -79.3832, 'America/Toronto'],'vancouver': [49.2827, -123.1207, 'America/Vancouver'],
  'calgary': [51.0447, -114.0719, 'America/Edmonton'], 'new york': [40.7128, -74.0060, 'America/New_York'],
  'new jersey': [40.0583, -74.4057, 'America/New_York'], 'boston': [42.3601, -71.0589, 'America/New_York'],
  'chicago': [41.8781, -87.6298, 'America/Chicago'],'dallas': [32.7767, -96.7970, 'America/Chicago'],
  'houston': [29.7604, -95.3698, 'America/Chicago'],'austin': [30.2672, -97.7431, 'America/Chicago'],
  'seattle': [47.6062, -122.3321, 'America/Los_Angeles'], 'san francisco': [37.7749, -122.4194, 'America/Los_Angeles'],
  'san jose': [37.3382, -121.8863, 'America/Los_Angeles'], 'los angeles': [34.0522, -118.2437, 'America/Los_Angeles'],
  'atlanta': [33.7490, -84.3880, 'America/New_York'], 'kathmandu': [27.7172, 85.3240, 'Asia/Kathmandu'],
  'colombo': [6.9271, 79.8612, 'Asia/Colombo'],     'dhaka': [23.8103, 90.4125, 'Asia/Dhaka'],
  'karachi': [24.8607, 67.0011, 'Asia/Karachi'],    'lahore': [31.5204, 74.3587, 'Asia/Karachi']
};

// Delhi is the default only when nothing at all is known, and the caller is
// told so - a silently wrong city gives silently wrong timings.
export const DEFAULT_PLACE = { name: 'New Delhi', lat: 28.6139, lon: 77.2090, tz: 'Asia/Kolkata', guessed: true };

export function placeOf(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return DEFAULT_PLACE;
  if (CITIES[t]) { const c = CITIES[t]; return { name: text.trim(), lat: c[0], lon: c[1], tz: c[2], guessed: false }; }
  // "Pune, Maharashtra" / "Greater Noida" - try each comma part, then any
  // known city named inside the string.
  for (const part of t.split(',').map(s => s.trim())) {
    if (CITIES[part]) { const c = CITIES[part]; return { name: text.trim(), lat: c[0], lon: c[1], tz: c[2], guessed: false }; }
  }
  const hit = Object.keys(CITIES).find(k => t.includes(k));
  if (hit) { const c = CITIES[hit]; return { name: text.trim(), lat: c[0], lon: c[1], tz: c[2], guessed: false }; }
  return { ...DEFAULT_PLACE, name: text.trim(), guessed: true };
}
