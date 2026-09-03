/**
 * FormNull — Country calling-code data (Field System 2.0, phone field)
 * =====================================================================
 * Static, real ITU E.164 dial-code data (public domain). No API, no
 * geolocation service — the phone control is honest client-side data.
 *
 * The list is intentionally compact: ISO 3166-1 alpha-2, display name,
 * and the calling code. Shared by the builder property editor (choose
 * a default) and the respondent-facing phone control (choose + compose).
 */

export interface Country {
  /** ISO 3166-1 alpha-2 */
  iso: string;
  name: string;
  /** ITU E.164 country calling code, without the leading "+". */
  dial: string;
}

/** Countries in a stable, human-useful order (largest user bases first,
 *  then alphabetical). The phone select renders this order directly. */
export const COUNTRIES: Country[] = [
  { iso: "US", name: "United States", dial: "1" },
  { iso: "CA", name: "Canada", dial: "1" },
  { iso: "GB", name: "United Kingdom", dial: "44" },
  { iso: "IN", name: "India", dial: "91" },
  { iso: "AU", name: "Australia", dial: "61" },
  { iso: "DE", name: "Germany", dial: "49" },
  { iso: "FR", name: "France", dial: "33" },
  { iso: "ES", name: "Spain", dial: "34" },
  { iso: "IT", name: "Italy", dial: "39" },
  { iso: "NL", name: "Netherlands", dial: "31" },
  { iso: "BR", name: "Brazil", dial: "55" },
  { iso: "MX", name: "Mexico", dial: "52" },
  { iso: "JP", name: "Japan", dial: "81" },
  { iso: "CN", name: "China", dial: "86" },
  { iso: "KR", name: "South Korea", dial: "82" },
  { iso: "SG", name: "Singapore", dial: "65" },
  { iso: "AE", name: "United Arab Emirates", dial: "971" },
  { iso: "SA", name: "Saudi Arabia", dial: "966" },
  { iso: "ZA", name: "South Africa", dial: "27" },
  { iso: "NG", name: "Nigeria", dial: "234" },
  { iso: "AR", name: "Argentina", dial: "54" },
  { iso: "CL", name: "Chile", dial: "56" },
  { iso: "CO", name: "Colombia", dial: "57" },
  { iso: "PE", name: "Peru", dial: "51" },
  { iso: "AF", name: "Afghanistan", dial: "93" },
  { iso: "AL", name: "Albania", dial: "355" },
  { iso: "DZ", name: "Algeria", dial: "213" },
  { iso: "AD", name: "Andorra", dial: "376" },
  { iso: "AO", name: "Angola", dial: "244" },
  { iso: "AG", name: "Antigua and Barbuda", dial: "1" },
  { iso: "AM", name: "Armenia", dial: "374" },
  { iso: "AT", name: "Austria", dial: "43" },
  { iso: "AZ", name: "Azerbaijan", dial: "994" },
  { iso: "BS", name: "Bahamas", dial: "1" },
  { iso: "BH", name: "Bahrain", dial: "973" },
  { iso: "BD", name: "Bangladesh", dial: "880" },
  { iso: "BB", name: "Barbados", dial: "1" },
  { iso: "BY", name: "Belarus", dial: "375" },
  { iso: "BE", name: "Belgium", dial: "32" },
  { iso: "BZ", name: "Belize", dial: "501" },
  { iso: "BJ", name: "Benin", dial: "229" },
  { iso: "BT", name: "Bhutan", dial: "975" },
  { iso: "BO", name: "Bolivia", dial: "591" },
  { iso: "BA", name: "Bosnia and Herzegovina", dial: "387" },
  { iso: "BW", name: "Botswana", dial: "267" },
  { iso: "VG", name: "British Virgin Islands", dial: "1" },
  { iso: "BN", name: "Brunei", dial: "673" },
  { iso: "BG", name: "Bulgaria", dial: "359" },
  { iso: "BF", name: "Burkina Faso", dial: "226" },
  { iso: "BI", name: "Burundi", dial: "257" },
  { iso: "KH", name: "Cambodia", dial: "855" },
  { iso: "CM", name: "Cameroon", dial: "237" },
  { iso: "CV", name: "Cape Verde", dial: "238" },
  { iso: "KY", name: "Cayman Islands", dial: "1" },
  { iso: "CF", name: "Central African Republic", dial: "236" },
  { iso: "TD", name: "Chad", dial: "235" },
  { iso: "CR", name: "Costa Rica", dial: "506" },
  { iso: "HR", name: "Croatia", dial: "385" },
  { iso: "CU", name: "Cuba", dial: "53" },
  { iso: "CY", name: "Cyprus", dial: "357" },
  { iso: "CZ", name: "Czechia", dial: "420" },
  { iso: "CD", name: "DR Congo", dial: "243" },
  { iso: "DK", name: "Denmark", dial: "45" },
  { iso: "DJ", name: "Djibouti", dial: "253" },
  { iso: "DM", name: "Dominica", dial: "1" },
  { iso: "DO", name: "Dominican Republic", dial: "1" },
  { iso: "EC", name: "Ecuador", dial: "593" },
  { iso: "EG", name: "Egypt", dial: "20" },
  { iso: "SV", name: "El Salvador", dial: "503" },
  { iso: "ER", name: "Eritrea", dial: "291" },
  { iso: "EE", name: "Estonia", dial: "372" },
  { iso: "SZ", name: "Eswatini", dial: "268" },
  { iso: "ET", name: "Ethiopia", dial: "251" },
  { iso: "FJ", name: "Fiji", dial: "679" },
  { iso: "FI", name: "Finland", dial: "358" },
  { iso: "GA", name: "Gabon", dial: "241" },
  { iso: "GM", name: "Gambia", dial: "220" },
  { iso: "GE", name: "Georgia", dial: "995" },
  { iso: "GH", name: "Ghana", dial: "233" },
  { iso: "GI", name: "Gibraltar", dial: "350" },
  { iso: "GR", name: "Greece", dial: "30" },
  { iso: "GL", name: "Greenland", dial: "299" },
  { iso: "GD", name: "Grenada", dial: "1" },
  { iso: "GU", name: "Guam", dial: "1" },
  { iso: "GT", name: "Guatemala", dial: "502" },
  { iso: "GN", name: "Guinea", dial: "224" },
  { iso: "GY", name: "Guyana", dial: "592" },
  { iso: "HT", name: "Haiti", dial: "509" },
  { iso: "HN", name: "Honduras", dial: "504" },
  { iso: "HK", name: "Hong Kong", dial: "852" },
  { iso: "HU", name: "Hungary", dial: "36" },
  { iso: "IS", name: "Iceland", dial: "354" },
  { iso: "ID", name: "Indonesia", dial: "62" },
  { iso: "IR", name: "Iran", dial: "98" },
  { iso: "IQ", name: "Iraq", dial: "964" },
  { iso: "IE", name: "Ireland", dial: "353" },
  { iso: "IL", name: "Israel", dial: "972" },
  { iso: "JM", name: "Jamaica", dial: "1" },
  { iso: "JO", name: "Jordan", dial: "962" },
  { iso: "KZ", name: "Kazakhstan", dial: "7" },
  { iso: "KE", name: "Kenya", dial: "254" },
  { iso: "KW", name: "Kuwait", dial: "965" },
  { iso: "KG", name: "Kyrgyzstan", dial: "996" },
  { iso: "LA", name: "Laos", dial: "856" },
  { iso: "LV", name: "Latvia", dial: "371" },
  { iso: "LB", name: "Lebanon", dial: "961" },
  { iso: "LS", name: "Lesotho", dial: "266" },
  { iso: "LR", name: "Liberia", dial: "231" },
  { iso: "LY", name: "Libya", dial: "218" },
  { iso: "LI", name: "Liechtenstein", dial: "423" },
  { iso: "LT", name: "Lithuania", dial: "370" },
  { iso: "LU", name: "Luxembourg", dial: "352" },
  { iso: "MO", name: "Macao", dial: "853" },
  { iso: "MG", name: "Madagascar", dial: "261" },
  { iso: "MW", name: "Malawi", dial: "265" },
  { iso: "MY", name: "Malaysia", dial: "60" },
  { iso: "MV", name: "Maldives", dial: "960" },
  { iso: "ML", name: "Mali", dial: "223" },
  { iso: "MT", name: "Malta", dial: "356" },
  { iso: "MH", name: "Marshall Islands", dial: "692" },
  { iso: "MR", name: "Mauritania", dial: "222" },
  { iso: "MU", name: "Mauritius", dial: "230" },
  { iso: "MD", name: "Moldova", dial: "373" },
  { iso: "MC", name: "Monaco", dial: "377" },
  { iso: "MN", name: "Mongolia", dial: "976" },
  { iso: "ME", name: "Montenegro", dial: "382" },
  { iso: "MA", name: "Morocco", dial: "212" },
  { iso: "MZ", name: "Mozambique", dial: "258" },
  { iso: "MM", name: "Myanmar", dial: "95" },
  { iso: "NA", name: "Namibia", dial: "264" },
  { iso: "NR", name: "Nauru", dial: "674" },
  { iso: "NP", name: "Nepal", dial: "977" },
  { iso: "NZ", name: "New Zealand", dial: "64" },
  { iso: "NI", name: "Nicaragua", dial: "505" },
  { iso: "NE", name: "Niger", dial: "227" },
  { iso: "NO", name: "Norway", dial: "47" },
  { iso: "OM", name: "Oman", dial: "968" },
  { iso: "PK", name: "Pakistan", dial: "92" },
  { iso: "PW", name: "Palau", dial: "680" },
  { iso: "PS", name: "Palestine", dial: "970" },
  { iso: "PA", name: "Panama", dial: "507" },
  { iso: "PG", name: "Papua New Guinea", dial: "675" },
  { iso: "PY", name: "Paraguay", dial: "595" },
  { iso: "PH", name: "Philippines", dial: "63" },
  { iso: "PL", name: "Poland", dial: "48" },
  { iso: "PT", name: "Portugal", dial: "351" },
  { iso: "QA", name: "Qatar", dial: "974" },
  { iso: "CG", name: "Republic of the Congo", dial: "242" },
  { iso: "RO", name: "Romania", dial: "40" },
  { iso: "RU", name: "Russia", dial: "7" },
  { iso: "RW", name: "Rwanda", dial: "250" },
  { iso: "KN", name: "Saint Kitts and Nevis", dial: "1" },
  { iso: "LC", name: "Saint Lucia", dial: "1" },
  { iso: "VC", name: "Saint Vincent and the Grenadines", dial: "1" },
  { iso: "WS", name: "Samoa", dial: "685" },
  { iso: "SM", name: "San Marino", dial: "378" },
  { iso: "ST", name: "Sao Tome and Principe", dial: "239" },
  { iso: "SN", name: "Senegal", dial: "221" },
  { iso: "RS", name: "Serbia", dial: "381" },
  { iso: "SC", name: "Seychelles", dial: "248" },
  { iso: "SL", name: "Sierra Leone", dial: "232" },
  { iso: "SK", name: "Slovakia", dial: "421" },
  { iso: "SI", name: "Slovenia", dial: "386" },
  { iso: "SB", name: "Solomon Islands", dial: "677" },
  { iso: "SO", name: "Somalia", dial: "252" },
  { iso: "LK", name: "Sri Lanka", dial: "94" },
  { iso: "SD", name: "Sudan", dial: "249" },
  { iso: "SR", name: "Suriname", dial: "597" },
  { iso: "SE", name: "Sweden", dial: "46" },
  { iso: "CH", name: "Switzerland", dial: "41" },
  { iso: "SY", name: "Syria", dial: "963" },
  { iso: "TW", name: "Taiwan", dial: "886" },
  { iso: "TJ", name: "Tajikistan", dial: "992" },
  { iso: "TZ", name: "Tanzania", dial: "255" },
  { iso: "TH", name: "Thailand", dial: "66" },
  { iso: "TL", name: "Timor-Leste", dial: "670" },
  { iso: "TG", name: "Togo", dial: "228" },
  { iso: "TO", name: "Tonga", dial: "676" },
  { iso: "TT", name: "Trinidad and Tobago", dial: "1" },
  { iso: "TN", name: "Tunisia", dial: "216" },
  { iso: "TR", name: "Turkey", dial: "90" },
  { iso: "TM", name: "Turkmenistan", dial: "993" },
  { iso: "TC", name: "Turks and Caicos Islands", dial: "1" },
  { iso: "UG", name: "Uganda", dial: "256" },
  { iso: "UA", name: "Ukraine", dial: "380" },
  { iso: "UY", name: "Uruguay", dial: "598" },
  { iso: "UZ", name: "Uzbekistan", dial: "998" },
  { iso: "VU", name: "Vanuatu", dial: "678" },
  { iso: "VA", name: "Vatican City", dial: "379" },
  { iso: "VE", name: "Venezuela", dial: "58" },
  { iso: "VN", name: "Vietnam", dial: "84" },
  { iso: "YE", name: "Yemen", dial: "967" },
  { iso: "ZM", name: "Zambia", dial: "260" },
  { iso: "ZW", name: "Zimbabwe", dial: "263" },
];

const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));

export function countryByIso(iso: string | null | undefined): Country | undefined {
  if (!iso) return undefined;
  return BY_ISO.get(iso.toUpperCase());
}

/**
 * Best-effort browser locale detection (no network, no geolocation
 * API). "en-IN" / "hi-IN" → IN; no region → undefined.
 */
export function detectCountryFromLocale(): Country | undefined {
  if (typeof navigator === "undefined") return undefined;
  const candidates =
    navigator.languages && navigator.languages.length > 0
      ? [...navigator.languages]
      : [navigator.language];
  for (const tag of candidates) {
    if (typeof tag !== "string") continue;
    const m = tag.match(/[-_]([A-Za-z]{2})$/);
    if (m) {
      const hit = countryByIso(m[1]);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * Split a previously stored phone string into (country, national).
 * Handles values composed by this control ("+91 98765 43210") and
 * legacy free-typed values ("+1 555 123 456", "5551234567").
 */
export function parsePhoneValue(
  value: string,
  fallback: Country | undefined,
): { country: Country | undefined; national: string } {
  const trimmed = value.trim();
  if (!trimmed) return { country: fallback, national: "" };

  if (trimmed.startsWith("+")) {
    // Longest-prefix match against dial codes (sorted desc).
    const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    for (const c of sorted) {
      if (trimmed === `+${c.dial}`) return { country: c, national: "" };
      if (trimmed.startsWith(`+${c.dial} `) || trimmed.startsWith(`+${c.dial}`)) {
        return { country: c, national: trimmed.slice(1 + c.dial.length).trim() };
      }
    }
    // Unrecognized dial code: keep the whole thing as the national part.
    return { country: fallback, national: trimmed };
  }

  return { country: fallback, national: trimmed };
}

/** Compose the stored answer: "+{dial} {national}". */
export function composePhoneValue(
  country: Country | undefined,
  national: string,
): string | undefined {
  const digits = national.trim();
  if (!country || digits === "") return undefined;
  return `+${country.dial} ${digits}`;
}
