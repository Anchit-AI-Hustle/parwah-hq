// WHOSE MONEY - the currency a family member pays in, from where they live.
// Imports nothing. A payment cap of "5000" means rupees in Pune and pounds in
// Leeds; the number alone never says which, so it is always shown with the
// currency of the person whose card or account it is.
const EURO = ['AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES'];
export const CURRENCY = {
  IN: 'INR', US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', AE: 'AED', SA: 'SAR', QA: 'QAR',
  KW: 'KWD', OM: 'OMR', BH: 'BHD', SG: 'SGD', MY: 'MYR', HK: 'HKD', NP: 'NPR', LK: 'LKR', BD: 'BDT',
  PK: 'PKR', BT: 'BTN', MV: 'MVR', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK',
  JP: 'JPY', KR: 'KRW', CN: 'CNY', TW: 'TWD', TH: 'THB', ID: 'IDR', PH: 'PHP', VN: 'VND', ZA: 'ZAR',
  KE: 'KES', NG: 'NGN', GH: 'GHS', UG: 'UGX', TZ: 'TZS', MU: 'MUR', EG: 'EGP', IL: 'ILS', TR: 'TRY',
  RU: 'RUB', UA: 'UAH', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', FJ: 'FJD',
  TT: 'TTD', GY: 'GYD', SR: 'SRD', JM: 'JMD', IS: 'ISK'
};
for (const c of EURO) CURRENCY[c] = 'EUR';

// No country recorded is the family Parwah started with: rupees. A country
// we have no currency for gets a plain number, never someone else's symbol.
export function currencyOf(iso) {
  const c = String(iso || '').toUpperCase();
  if (!c) return 'INR';
  return CURRENCY[c] || null;
}

export function money(n, cur) {
  const v = Number(n) || 0;
  if (!cur) return v.toLocaleString('en-US');
  try {
    return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en', { style: 'currency', currency: cur, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(v);
  } catch (e) { return cur + ' ' + v.toLocaleString('en-US'); }
}
