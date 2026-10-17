// Where a family member lives, as coordinates - because Choghadiya is a
// property of a PLACE, not of a country. Free text is matched loosely so
// "New Delhi", "delhi" and "Delhi, India" all land in the same spot.
// No dependency, no network, no key: a lookup table is testable and never
// rate-limits a family at six in the morning.
export const CITIES = {
  // India
  'delhi': [28.6139, 77.2090, 'Asia/Kolkata', 'IN'],      'new delhi': [28.6139, 77.2090, 'Asia/Kolkata', 'IN'],
  'gurgaon': [28.4595, 77.0266, 'Asia/Kolkata', 'IN'],    'gurugram': [28.4595, 77.0266, 'Asia/Kolkata', 'IN'],
  'noida': [28.5355, 77.3910, 'Asia/Kolkata', 'IN'],      'faridabad': [28.4089, 77.3178, 'Asia/Kolkata', 'IN'],
  'mumbai': [19.0760, 72.8777, 'Asia/Kolkata', 'IN'],     'bombay': [19.0760, 72.8777, 'Asia/Kolkata', 'IN'],
  'thane': [19.2183, 72.9781, 'Asia/Kolkata', 'IN'],      'navi mumbai': [19.0330, 73.0297, 'Asia/Kolkata', 'IN'],
  'pune': [18.5204, 73.8567, 'Asia/Kolkata', 'IN'],       'nagpur': [21.1458, 79.0882, 'Asia/Kolkata', 'IN'],
  'bangalore': [12.9716, 77.5946, 'Asia/Kolkata', 'IN'],  'bengaluru': [12.9716, 77.5946, 'Asia/Kolkata', 'IN'],
  'chennai': [13.0827, 80.2707, 'Asia/Kolkata', 'IN'],    'madras': [13.0827, 80.2707, 'Asia/Kolkata', 'IN'],
  'hyderabad': [17.3850, 78.4867, 'Asia/Kolkata', 'IN'],  'kolkata': [22.5726, 88.3639, 'Asia/Kolkata', 'IN'],
  'calcutta': [22.5726, 88.3639, 'Asia/Kolkata', 'IN'],   'ahmedabad': [23.0225, 72.5714, 'Asia/Kolkata', 'IN'],
  'surat': [21.1702, 72.8311, 'Asia/Kolkata', 'IN'],      'vadodara': [22.3072, 73.1812, 'Asia/Kolkata', 'IN'],
  'jaipur': [26.9124, 75.7873, 'Asia/Kolkata', 'IN'],     'lucknow': [26.8467, 80.9462, 'Asia/Kolkata', 'IN'],
  'kanpur': [26.4499, 80.3319, 'Asia/Kolkata', 'IN'],     'indore': [22.7196, 75.8577, 'Asia/Kolkata', 'IN'],
  'bhopal': [23.2599, 77.4126, 'Asia/Kolkata', 'IN'],     'patna': [25.5941, 85.1376, 'Asia/Kolkata', 'IN'],
  'chandigarh': [30.7333, 76.7794, 'Asia/Kolkata', 'IN'], 'ludhiana': [30.9010, 75.8573, 'Asia/Kolkata', 'IN'],
  'amritsar': [31.6340, 74.8723, 'Asia/Kolkata', 'IN'],   'dehradun': [30.3165, 78.0322, 'Asia/Kolkata', 'IN'],
  'kochi': [9.9312, 76.2673, 'Asia/Kolkata', 'IN'],       'cochin': [9.9312, 76.2673, 'Asia/Kolkata', 'IN'],
  'thiruvananthapuram': [8.5241, 76.9366, 'Asia/Kolkata', 'IN'], 'coimbatore': [11.0168, 76.9558, 'Asia/Kolkata', 'IN'],
  'visakhapatnam': [17.6868, 83.2185, 'Asia/Kolkata', 'IN'], 'bhubaneswar': [20.2961, 85.8245, 'Asia/Kolkata', 'IN'],
  'guwahati': [26.1445, 91.7362, 'Asia/Kolkata', 'IN'],   'varanasi': [25.3176, 82.9739, 'Asia/Kolkata', 'IN'],
  'agra': [27.1767, 78.0081, 'Asia/Kolkata', 'IN'],       'nashik': [19.9975, 73.7898, 'Asia/Kolkata', 'IN'],
  'rajkot': [22.3039, 70.8022, 'Asia/Kolkata', 'IN'],     'jodhpur': [26.2389, 73.0243, 'Asia/Kolkata', 'IN'],
  'mysore': [12.2958, 76.6394, 'Asia/Kolkata', 'IN'],     'mysuru': [12.2958, 76.6394, 'Asia/Kolkata', 'IN'],
  'shimla': [31.1048, 77.1734, 'Asia/Kolkata', 'IN'],     'goa': [15.2993, 74.1240, 'Asia/Kolkata', 'IN'],
  // where the children live
  'london': [51.5074, -0.1278, 'Europe/London', 'GB'],    'manchester': [53.4808, -2.2426, 'Europe/London', 'GB'],
  'birmingham': [52.4862, -1.8904, 'Europe/London', 'GB'],'edinburgh': [55.9533, -3.1883, 'Europe/London', 'GB'],
  'dubai': [25.2048, 55.2708, 'Asia/Dubai', 'AE'],        'abu dhabi': [24.4539, 54.3773, 'Asia/Dubai', 'AE'],
  'sharjah': [25.3463, 55.4209, 'Asia/Dubai', 'AE'],      'doha': [25.2854, 51.5310, 'Asia/Qatar', 'QA'],
  'singapore': [1.3521, 103.8198, 'Asia/Singapore', 'SG'],'hong kong': [22.3193, 114.1694, 'Asia/Hong_Kong', 'HK'],
  'sydney': [-33.8688, 151.2093, 'Australia/Sydney', 'AU'], 'melbourne': [-37.8136, 144.9631, 'Australia/Melbourne', 'AU'],
  'perth': [-31.9505, 115.8605, 'Australia/Perth', 'AU'], 'auckland': [-36.8485, 174.7633, 'Pacific/Auckland', 'NZ'],
  'toronto': [43.6532, -79.3832, 'America/Toronto', 'CA'],'vancouver': [49.2827, -123.1207, 'America/Vancouver', 'CA'],
  'calgary': [51.0447, -114.0719, 'America/Edmonton', 'CA'], 'new york': [40.7128, -74.0060, 'America/New_York', 'US'],
  'new jersey': [40.0583, -74.4057, 'America/New_York', 'US'], 'boston': [42.3601, -71.0589, 'America/New_York', 'US'],
  'chicago': [41.8781, -87.6298, 'America/Chicago', 'US'],'dallas': [32.7767, -96.7970, 'America/Chicago', 'US'],
  'houston': [29.7604, -95.3698, 'America/Chicago', 'US'],'austin': [30.2672, -97.7431, 'America/Chicago', 'US'],
  'seattle': [47.6062, -122.3321, 'America/Los_Angeles', 'US'], 'san francisco': [37.7749, -122.4194, 'America/Los_Angeles', 'US'],
  'san jose': [37.3382, -121.8863, 'America/Los_Angeles', 'US'], 'los angeles': [34.0522, -118.2437, 'America/Los_Angeles', 'US'],
  'atlanta': [33.7490, -84.3880, 'America/New_York', 'US'], 'kathmandu': [27.7172, 85.3240, 'Asia/Kathmandu', 'NP'],
  'colombo': [6.9271, 79.8612, 'Asia/Colombo', 'LK'],     'dhaka': [23.8103, 90.4125, 'Asia/Dhaka', 'BD'],
  'karachi': [24.8607, 67.0011, 'Asia/Karachi', 'PK'],    'lahore': [31.5204, 74.3587, 'Asia/Karachi', 'PK'],
  // further afield - the city decides the sun, the country decides the rest
  'leicester': [52.6369, -1.1398, 'Europe/London', 'GB'], 'leeds': [53.8008, -1.5491, 'Europe/London', 'GB'],
  'glasgow': [55.8642, -4.2518, 'Europe/London', 'GB'], 'cardiff': [51.4816, -3.1791, 'Europe/London', 'GB'],
  'belfast': [54.5973, -5.9301, 'Europe/London', 'GB'], 'dublin': [53.3498, -6.2603, 'Europe/Dublin', 'IE'],
  'paris': [48.8566, 2.3522, 'Europe/Paris', 'FR'], 'berlin': [52.5200, 13.4050, 'Europe/Berlin', 'DE'],
  'munich': [48.1351, 11.5820, 'Europe/Berlin', 'DE'], 'frankfurt': [50.1109, 8.6821, 'Europe/Berlin', 'DE'],
  'amsterdam': [52.3676, 4.9041, 'Europe/Amsterdam', 'NL'], 'brussels': [50.8503, 4.3517, 'Europe/Brussels', 'BE'],
  'zurich': [47.3769, 8.5417, 'Europe/Zurich', 'CH'], 'geneva': [46.2044, 6.1432, 'Europe/Zurich', 'CH'],
  'madrid': [40.4168, -3.7038, 'Europe/Madrid', 'ES'], 'barcelona': [41.3874, 2.1686, 'Europe/Madrid', 'ES'],
  'lisbon': [38.7223, -9.1393, 'Europe/Lisbon', 'PT'], 'rome': [41.9028, 12.4964, 'Europe/Rome', 'IT'],
  'milan': [45.4642, 9.1900, 'Europe/Rome', 'IT'], 'vienna': [48.2082, 16.3738, 'Europe/Vienna', 'AT'],
  'stockholm': [59.3293, 18.0686, 'Europe/Stockholm', 'SE'], 'oslo': [59.9139, 10.7522, 'Europe/Oslo', 'NO'],
  'copenhagen': [55.6761, 12.5683, 'Europe/Copenhagen', 'DK'], 'helsinki': [60.1699, 24.9384, 'Europe/Helsinki', 'FI'],
  'warsaw': [52.2297, 21.0122, 'Europe/Warsaw', 'PL'], 'prague': [50.0755, 14.4378, 'Europe/Prague', 'CZ'],
  'athens': [37.9838, 23.7275, 'Europe/Athens', 'GR'], 'istanbul': [41.0082, 28.9784, 'Europe/Istanbul', 'TR'],
  'moscow': [55.7558, 37.6173, 'Europe/Moscow', 'RU'], 'kyiv': [50.4501, 30.5234, 'Europe/Kyiv', 'UA'],
  'riyadh': [24.7136, 46.6753, 'Asia/Riyadh', 'SA'], 'jeddah': [21.4858, 39.1925, 'Asia/Riyadh', 'SA'],
  'muscat': [23.5880, 58.3829, 'Asia/Muscat', 'OM'], 'kuwait city': [29.3759, 47.9774, 'Asia/Kuwait', 'KW'],
  'manama': [26.2285, 50.5860, 'Asia/Bahrain', 'BH'], 'tel aviv': [32.0853, 34.7818, 'Asia/Jerusalem', 'IL'],
  'cairo': [30.0444, 31.2357, 'Africa/Cairo', 'EG'], 'nairobi': [-1.2921, 36.8219, 'Africa/Nairobi', 'KE'],
  'lagos': [6.5244, 3.3792, 'Africa/Lagos', 'NG'], 'johannesburg': [-26.2041, 28.0473, 'Africa/Johannesburg', 'ZA'],
  'cape town': [-33.9249, 18.4241, 'Africa/Johannesburg', 'ZA'], 'durban': [-29.8587, 31.0218, 'Africa/Johannesburg', 'ZA'],
  'dar es salaam': [-6.7924, 39.2083, 'Africa/Dar_es_Salaam', 'TZ'], 'kampala': [0.3476, 32.5825, 'Africa/Kampala', 'UG'],
  'accra': [5.6037, -0.1870, 'Africa/Accra', 'GH'], 'port louis': [-20.1609, 57.5012, 'Indian/Mauritius', 'MU'],
  'kuala lumpur': [3.1390, 101.6869, 'Asia/Kuala_Lumpur', 'MY'], 'bangkok': [13.7563, 100.5018, 'Asia/Bangkok', 'TH'],
  'jakarta': [-6.2088, 106.8456, 'Asia/Jakarta', 'ID'], 'manila': [14.5995, 120.9842, 'Asia/Manila', 'PH'],
  'tokyo': [35.6762, 139.6503, 'Asia/Tokyo', 'JP'], 'seoul': [37.5665, 126.9780, 'Asia/Seoul', 'KR'],
  'beijing': [39.9042, 116.4074, 'Asia/Shanghai', 'CN'], 'shanghai': [31.2304, 121.4737, 'Asia/Shanghai', 'CN'],
  'taipei': [25.0330, 121.5654, 'Asia/Taipei', 'TW'], 'ho chi minh city': [10.8231, 106.6297, 'Asia/Ho_Chi_Minh', 'VN'],
  'brisbane': [-27.4698, 153.0251, 'Australia/Brisbane', 'AU'], 'adelaide': [-34.9285, 138.6007, 'Australia/Adelaide', 'AU'],
  'canberra': [-35.2809, 149.1300, 'Australia/Sydney', 'AU'], 'wellington': [-41.2866, 174.7756, 'Pacific/Auckland', 'NZ'],
  'suva': [-18.1248, 178.4501, 'Pacific/Fiji', 'FJ'], 'montreal': [45.5019, -73.5674, 'America/Toronto', 'CA'],
  'ottawa': [45.4215, -75.6972, 'America/Toronto', 'CA'], 'edmonton': [53.5461, -113.4938, 'America/Edmonton', 'CA'],
  'winnipeg': [49.8951, -97.1384, 'America/Winnipeg', 'CA'], 'brampton': [43.7315, -79.7624, 'America/Toronto', 'CA'],
  'mississauga': [43.5890, -79.6441, 'America/Toronto', 'CA'], 'surrey': [49.1913, -122.8490, 'America/Vancouver', 'CA'],
  'washington': [38.9072, -77.0369, 'America/New_York', 'US'], 'philadelphia': [39.9526, -75.1652, 'America/New_York', 'US'],
  'miami': [25.7617, -80.1918, 'America/New_York', 'US'], 'orlando': [28.5384, -81.3789, 'America/New_York', 'US'],
  'detroit': [42.3314, -83.0458, 'America/Detroit', 'US'], 'minneapolis': [44.9778, -93.2650, 'America/Chicago', 'US'],
  'denver': [39.7392, -104.9903, 'America/Denver', 'US'], 'phoenix': [33.4484, -112.0740, 'America/Phoenix', 'US'],
  'san diego': [32.7157, -117.1611, 'America/Los_Angeles', 'US'], 'portland': [45.5152, -122.6784, 'America/Los_Angeles', 'US'],
  'honolulu': [21.3069, -157.8583, 'Pacific/Honolulu', 'US'], 'anchorage': [61.2181, -149.9003, 'America/Anchorage', 'US'],
  'mexico city': [19.4326, -99.1332, 'America/Mexico_City', 'MX'], 'sao paulo': [-23.5505, -46.6333, 'America/Sao_Paulo', 'BR'],
  'rio de janeiro': [-22.9068, -43.1729, 'America/Sao_Paulo', 'BR'], 'buenos aires': [-34.6037, -58.3816, 'America/Argentina/Buenos_Aires', 'AR'],
  'santiago': [-33.4489, -70.6693, 'America/Santiago', 'CL'], 'lima': [-12.0464, -77.0428, 'America/Lima', 'PE'],
  'bogota': [4.7110, -74.0721, 'America/Bogota', 'CO'], 'port of spain': [10.6603, -61.5086, 'America/Port_of_Spain', 'TT'],
  'georgetown': [6.8013, -58.1551, 'America/Guyana', 'GY'], 'paramaribo': [5.8520, -55.2038, 'America/Paramaribo', 'SR'],
  'kingston': [17.9714, -76.7920, 'America/Jamaica', 'JM'], 'reykjavik': [64.1466, -21.9426, 'Atlantic/Reykjavik', 'IS'],
  'tromso': [69.6492, 18.9553, 'Europe/Oslo', 'NO'], 'thimphu': [27.4728, 89.6390, 'Asia/Thimphu', 'BT'],
  'male': [4.1755, 73.5093, 'Indian/Maldives', 'MV'], 'kabul': [34.5553, 69.2075, 'Asia/Kabul', 'AF'],
  'islamabad': [33.6844, 73.0479, 'Asia/Karachi', 'PK'], 'chittagong': [22.3569, 91.7832, 'Asia/Dhaka', 'BD']
};

// When the city is unknown but the country is, the capital is a far better
// guess than Delhi: a family in Toronto shown Delhi sunrise is off by ten
// hours. [lat, lon, tz, name]. Still flagged as a guess.
export const CAPITALS = {
  IN: [28.6139, 77.2090, 'Asia/Kolkata', 'New Delhi'], US: [38.9072, -77.0369, 'America/New_York', 'Washington'],
  GB: [51.5074, -0.1278, 'Europe/London', 'London'], CA: [45.4215, -75.6972, 'America/Toronto', 'Ottawa'],
  AU: [-35.2809, 149.1300, 'Australia/Sydney', 'Canberra'], NZ: [-41.2866, 174.7756, 'Pacific/Auckland', 'Wellington'],
  AE: [24.4539, 54.3773, 'Asia/Dubai', 'Abu Dhabi'], SA: [24.7136, 46.6753, 'Asia/Riyadh', 'Riyadh'],
  QA: [25.2854, 51.5310, 'Asia/Qatar', 'Doha'], KW: [29.3759, 47.9774, 'Asia/Kuwait', 'Kuwait City'],
  OM: [23.5880, 58.3829, 'Asia/Muscat', 'Muscat'], BH: [26.2285, 50.5860, 'Asia/Bahrain', 'Manama'],
  SG: [1.3521, 103.8198, 'Asia/Singapore', 'Singapore'], MY: [3.1390, 101.6869, 'Asia/Kuala_Lumpur', 'Kuala Lumpur'],
  HK: [22.3193, 114.1694, 'Asia/Hong_Kong', 'Hong Kong'], NP: [27.7172, 85.3240, 'Asia/Kathmandu', 'Kathmandu'],
  LK: [6.9271, 79.8612, 'Asia/Colombo', 'Colombo'], BD: [23.8103, 90.4125, 'Asia/Dhaka', 'Dhaka'],
  PK: [33.6844, 73.0479, 'Asia/Karachi', 'Islamabad'], BT: [27.4728, 89.6390, 'Asia/Thimphu', 'Thimphu'],
  MV: [4.1755, 73.5093, 'Indian/Maldives', 'Male'], AF: [34.5553, 69.2075, 'Asia/Kabul', 'Kabul'],
  IE: [53.3498, -6.2603, 'Europe/Dublin', 'Dublin'], FR: [48.8566, 2.3522, 'Europe/Paris', 'Paris'],
  DE: [52.5200, 13.4050, 'Europe/Berlin', 'Berlin'], NL: [52.3676, 4.9041, 'Europe/Amsterdam', 'Amsterdam'],
  BE: [50.8503, 4.3517, 'Europe/Brussels', 'Brussels'], CH: [46.9480, 7.4474, 'Europe/Zurich', 'Bern'],
  ES: [40.4168, -3.7038, 'Europe/Madrid', 'Madrid'], PT: [38.7223, -9.1393, 'Europe/Lisbon', 'Lisbon'],
  IT: [41.9028, 12.4964, 'Europe/Rome', 'Rome'], AT: [48.2082, 16.3738, 'Europe/Vienna', 'Vienna'],
  SE: [59.3293, 18.0686, 'Europe/Stockholm', 'Stockholm'], NO: [59.9139, 10.7522, 'Europe/Oslo', 'Oslo'],
  DK: [55.6761, 12.5683, 'Europe/Copenhagen', 'Copenhagen'], FI: [60.1699, 24.9384, 'Europe/Helsinki', 'Helsinki'],
  PL: [52.2297, 21.0122, 'Europe/Warsaw', 'Warsaw'], CZ: [50.0755, 14.4378, 'Europe/Prague', 'Prague'],
  GR: [37.9838, 23.7275, 'Europe/Athens', 'Athens'], TR: [39.9334, 32.8597, 'Europe/Istanbul', 'Ankara'],
  RU: [55.7558, 37.6173, 'Europe/Moscow', 'Moscow'], UA: [50.4501, 30.5234, 'Europe/Kyiv', 'Kyiv'],
  IS: [64.1466, -21.9426, 'Atlantic/Reykjavik', 'Reykjavik'], IL: [31.7683, 35.2137, 'Asia/Jerusalem', 'Jerusalem'],
  EG: [30.0444, 31.2357, 'Africa/Cairo', 'Cairo'], KE: [-1.2921, 36.8219, 'Africa/Nairobi', 'Nairobi'],
  NG: [9.0765, 7.3986, 'Africa/Lagos', 'Abuja'], ZA: [-25.7479, 28.2293, 'Africa/Johannesburg', 'Pretoria'],
  TZ: [-6.1630, 35.7516, 'Africa/Dar_es_Salaam', 'Dodoma'], UG: [0.3476, 32.5825, 'Africa/Kampala', 'Kampala'],
  GH: [5.6037, -0.1870, 'Africa/Accra', 'Accra'], MU: [-20.1609, 57.5012, 'Indian/Mauritius', 'Port Louis'],
  TH: [13.7563, 100.5018, 'Asia/Bangkok', 'Bangkok'], ID: [-6.2088, 106.8456, 'Asia/Jakarta', 'Jakarta'],
  PH: [14.5995, 120.9842, 'Asia/Manila', 'Manila'], JP: [35.6762, 139.6503, 'Asia/Tokyo', 'Tokyo'],
  KR: [37.5665, 126.9780, 'Asia/Seoul', 'Seoul'], CN: [39.9042, 116.4074, 'Asia/Shanghai', 'Beijing'],
  TW: [25.0330, 121.5654, 'Asia/Taipei', 'Taipei'], VN: [21.0278, 105.8342, 'Asia/Ho_Chi_Minh', 'Hanoi'],
  FJ: [-18.1248, 178.4501, 'Pacific/Fiji', 'Suva'], MX: [19.4326, -99.1332, 'America/Mexico_City', 'Mexico City'],
  BR: [-15.7975, -47.8919, 'America/Sao_Paulo', 'Brasilia'], AR: [-34.6037, -58.3816, 'America/Argentina/Buenos_Aires', 'Buenos Aires'],
  CL: [-33.4489, -70.6693, 'America/Santiago', 'Santiago'], PE: [-12.0464, -77.0428, 'America/Lima', 'Lima'],
  CO: [4.7110, -74.0721, 'America/Bogota', 'Bogota'], TT: [10.6603, -61.5086, 'America/Port_of_Spain', 'Port of Spain'],
  GY: [6.8013, -58.1551, 'America/Guyana', 'Georgetown'], SR: [5.8520, -55.2038, 'America/Paramaribo', 'Paramaribo'],
  JM: [17.9714, -76.7920, 'America/Jamaica', 'Kingston']
};

// Delhi is the default only when nothing at all is known, and the caller is
// told so - a silently wrong city gives silently wrong timings.
export const DEFAULT_PLACE = { name: 'New Delhi', lat: 28.6139, lon: 77.2090, tz: 'Asia/Kolkata', guessed: true };

const SHARED_NAMES = new Set(['london', 'perth', 'birmingham', 'georgetown', 'kingston', 'portland', 'surrey', 'santiago', 'washington', 'hyderabad', 'manchester', 'cambridge', 'richmond', 'victoria']);
const hitOf = (text, c) => ({ name: text.trim(), lat: c[0], lon: c[1], tz: c[2], iso: c[3], guessed: false });
const wordIn = (t, k) => new RegExp('(^|[^a-z])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z])').test(t);

// The fallback when the city is unknown: the capital of the member's
// country, else any known city in the phone's own timezone, else Delhi.
// Each says which place it used, so the screen can say so honestly.
function fallbackOf(country, tz) {
  const cc = String(country || '').toUpperCase();
  if (CAPITALS[cc]) { const c = CAPITALS[cc]; return { lat: c[0], lon: c[1], tz: c[2], iso: cc, usedName: c[3], guessed: true }; }
  if (tz) {
    const k = Object.keys(CITIES).find(n => CITIES[n][2] === tz);
    if (k) { const c = CITIES[k]; return { lat: c[0], lon: c[1], tz: c[2], iso: c[3], usedName: k.replace(/\b\w/g, x => x.toUpperCase()), guessed: true }; }
  }
  return { ...DEFAULT_PLACE, iso: 'IN', usedName: DEFAULT_PLACE.name };
}

export function placeOf(text, country, tz) {
  const t = String(text || '').trim().toLowerCase();
  const cc = String(country || '').toUpperCase();
  // No city at all is not an unknown city: the app says "add your city",
  // not "we don't know New Delhi".
  if (!t) { const f = fallbackOf(cc, tz); return { ...f, name: f.usedName, unset: true }; }
  // A few names are real cities in more than one country ("London,
  // Ontario", "Perth" in Scotland, Hyderabad in Sindh). For those only, a
  // match in another country than the member's is set aside for their own
  // capital. Any other city wins over the profile country, which is often
  // where the family is from rather than where this person lives.
  const fits = (c, k) => !SHARED_NAMES.has(k) || !CAPITALS[cc] || c[3] === cc;
  if (CITIES[t] && fits(CITIES[t], t)) return hitOf(text, CITIES[t]);
  // "Pune, Maharashtra" / "Greater Noida" - try each comma part, then any
  // known city named as a whole word inside the string.
  for (const part of t.split(',').map(s => s.trim())) {
    if (CITIES[part] && fits(CITIES[part], part)) return hitOf(text, CITIES[part]);
  }
  const hit = Object.keys(CITIES).sort((a, b) => b.length - a.length).find(k => wordIn(t, k) && fits(CITIES[k], k));
  if (hit) return hitOf(text, CITIES[hit]);
  return { ...fallbackOf(cc, tz), name: text.trim() };
}
