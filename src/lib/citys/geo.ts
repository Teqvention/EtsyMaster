// Countries as the city knowledge needs them: ISO 3166 alpha-2 code, the
// English name buyers search by, and the continent. Fixed here rather than
// asked of Gemini, so a continent chart never splits one country over two.

export const CONTINENTS = ["Europe", "North America", "South America", "Asia", "Africa", "Oceania", "Antarctica"] as const
export type Continent = (typeof CONTINENTS)[number]

const E = "Europe"
const N = "North America"
const S = "South America"
const A = "Asia"
const F = "Africa"
const O = "Oceania"

// [code, name, continent]
const TABLE: [string, string, Continent][] = [
  ["AD", "Andorra", E], ["AE", "United Arab Emirates", A], ["AF", "Afghanistan", A], ["AG", "Antigua and Barbuda", N],
  ["AI", "Anguilla", N], ["AL", "Albania", E], ["AM", "Armenia", A], ["AO", "Angola", F], ["AQ", "Antarctica", "Antarctica"],
  ["AR", "Argentina", S], ["AS", "American Samoa", O], ["AT", "Austria", E], ["AU", "Australia", O], ["AW", "Aruba", N],
  ["AX", "Åland Islands", E], ["AZ", "Azerbaijan", A], ["BA", "Bosnia and Herzegovina", E], ["BB", "Barbados", N],
  ["BD", "Bangladesh", A], ["BE", "Belgium", E], ["BF", "Burkina Faso", F], ["BG", "Bulgaria", E], ["BH", "Bahrain", A],
  ["BI", "Burundi", F], ["BJ", "Benin", F], ["BL", "Saint Barthélemy", N], ["BM", "Bermuda", N], ["BN", "Brunei", A],
  ["BO", "Bolivia", S], ["BQ", "Caribbean Netherlands", N], ["BR", "Brazil", S], ["BS", "Bahamas", N], ["BT", "Bhutan", A],
  ["BW", "Botswana", F], ["BY", "Belarus", E], ["BZ", "Belize", N], ["CA", "Canada", N], ["CD", "DR Congo", F],
  ["CF", "Central African Republic", F], ["CG", "Congo", F], ["CH", "Switzerland", E], ["CI", "Ivory Coast", F],
  ["CK", "Cook Islands", O], ["CL", "Chile", S], ["CM", "Cameroon", F], ["CN", "China", A], ["CO", "Colombia", S],
  ["CR", "Costa Rica", N], ["CU", "Cuba", N], ["CV", "Cape Verde", F], ["CW", "Curaçao", N], ["CY", "Cyprus", E],
  ["CZ", "Czech Republic", E], ["DE", "Germany", E], ["DJ", "Djibouti", F], ["DK", "Denmark", E], ["DM", "Dominica", N],
  ["DO", "Dominican Republic", N], ["DZ", "Algeria", F], ["EC", "Ecuador", S], ["EE", "Estonia", E], ["EG", "Egypt", F],
  ["EH", "Western Sahara", F], ["ER", "Eritrea", F], ["ES", "Spain", E], ["ET", "Ethiopia", F], ["FI", "Finland", E],
  ["FJ", "Fiji", O], ["FK", "Falkland Islands", S], ["FM", "Micronesia", O], ["FO", "Faroe Islands", E], ["FR", "France", E],
  ["GA", "Gabon", F], ["GB", "United Kingdom", E], ["GD", "Grenada", N], ["GE", "Georgia", A], ["GF", "French Guiana", S],
  ["GG", "Guernsey", E], ["GH", "Ghana", F], ["GI", "Gibraltar", E], ["GL", "Greenland", N], ["GM", "Gambia", F],
  ["GN", "Guinea", F], ["GP", "Guadeloupe", N], ["GQ", "Equatorial Guinea", F], ["GR", "Greece", E], ["GT", "Guatemala", N],
  ["GU", "Guam", O], ["GW", "Guinea-Bissau", F], ["GY", "Guyana", S], ["HK", "Hong Kong", A], ["HN", "Honduras", N],
  ["HR", "Croatia", E], ["HT", "Haiti", N], ["HU", "Hungary", E], ["ID", "Indonesia", A], ["IE", "Ireland", E],
  ["IL", "Israel", A], ["IM", "Isle of Man", E], ["IN", "India", A], ["IQ", "Iraq", A], ["IR", "Iran", A], ["IS", "Iceland", E],
  ["IT", "Italy", E], ["JE", "Jersey", E], ["JM", "Jamaica", N], ["JO", "Jordan", A], ["JP", "Japan", A], ["KE", "Kenya", F],
  ["KG", "Kyrgyzstan", A], ["KH", "Cambodia", A], ["KI", "Kiribati", O], ["KM", "Comoros", F], ["KN", "Saint Kitts and Nevis", N],
  ["KP", "North Korea", A], ["KR", "South Korea", A], ["KW", "Kuwait", A], ["KY", "Cayman Islands", N], ["KZ", "Kazakhstan", A],
  ["LA", "Laos", A], ["LB", "Lebanon", A], ["LC", "Saint Lucia", N], ["LI", "Liechtenstein", E], ["LK", "Sri Lanka", A],
  ["LR", "Liberia", F], ["LS", "Lesotho", F], ["LT", "Lithuania", E], ["LU", "Luxembourg", E], ["LV", "Latvia", E],
  ["LY", "Libya", F], ["MA", "Morocco", F], ["MC", "Monaco", E], ["MD", "Moldova", E], ["ME", "Montenegro", E],
  ["MF", "Saint Martin", N], ["MG", "Madagascar", F], ["MH", "Marshall Islands", O], ["MK", "North Macedonia", E],
  ["ML", "Mali", F], ["MM", "Myanmar", A], ["MN", "Mongolia", A], ["MO", "Macau", A], ["MP", "Northern Mariana Islands", O],
  ["MQ", "Martinique", N], ["MR", "Mauritania", F], ["MS", "Montserrat", N], ["MT", "Malta", E], ["MU", "Mauritius", F],
  ["MV", "Maldives", A], ["MW", "Malawi", F], ["MX", "Mexico", N], ["MY", "Malaysia", A], ["MZ", "Mozambique", F],
  ["NA", "Namibia", F], ["NC", "New Caledonia", O], ["NE", "Niger", F], ["NG", "Nigeria", F], ["NI", "Nicaragua", N],
  ["NL", "Netherlands", E], ["NO", "Norway", E], ["NP", "Nepal", A], ["NR", "Nauru", O], ["NZ", "New Zealand", O],
  ["OM", "Oman", A], ["PA", "Panama", N], ["PE", "Peru", S], ["PF", "French Polynesia", O], ["PG", "Papua New Guinea", O],
  ["PH", "Philippines", A], ["PK", "Pakistan", A], ["PL", "Poland", E], ["PM", "Saint Pierre and Miquelon", N],
  ["PR", "Puerto Rico", N], ["PS", "Palestine", A], ["PT", "Portugal", E], ["PW", "Palau", O], ["PY", "Paraguay", S],
  ["QA", "Qatar", A], ["RE", "Réunion", F], ["RO", "Romania", E], ["RS", "Serbia", E], ["RU", "Russia", E], ["RW", "Rwanda", F],
  ["SA", "Saudi Arabia", A], ["SB", "Solomon Islands", O], ["SC", "Seychelles", F], ["SD", "Sudan", F], ["SE", "Sweden", E],
  ["SG", "Singapore", A], ["SH", "Saint Helena", F], ["SI", "Slovenia", E], ["SK", "Slovakia", E], ["SL", "Sierra Leone", F],
  ["SM", "San Marino", E], ["SN", "Senegal", F], ["SO", "Somalia", F], ["SR", "Suriname", S], ["SS", "South Sudan", F],
  ["ST", "São Tomé and Príncipe", F], ["SV", "El Salvador", N], ["SX", "Sint Maarten", N], ["SY", "Syria", A],
  ["SZ", "Eswatini", F], ["TC", "Turks and Caicos", N], ["TD", "Chad", F], ["TG", "Togo", F], ["TH", "Thailand", A],
  ["TJ", "Tajikistan", A], ["TL", "Timor-Leste", A], ["TM", "Turkmenistan", A], ["TN", "Tunisia", F], ["TO", "Tonga", O],
  ["TR", "Turkey", A], ["TT", "Trinidad and Tobago", N], ["TV", "Tuvalu", O], ["TW", "Taiwan", A], ["TZ", "Tanzania", F],
  ["UA", "Ukraine", E], ["UG", "Uganda", F], ["US", "United States", N], ["UY", "Uruguay", S], ["UZ", "Uzbekistan", A],
  ["VA", "Vatican City", E], ["VC", "Saint Vincent and the Grenadines", N], ["VE", "Venezuela", S],
  ["VG", "British Virgin Islands", N], ["VI", "U.S. Virgin Islands", N], ["VN", "Vietnam", A], ["VU", "Vanuatu", O],
  ["WS", "Samoa", O], ["XK", "Kosovo", E], ["YE", "Yemen", A], ["YT", "Mayotte", F], ["ZA", "South Africa", F],
  ["ZM", "Zambia", F], ["ZW", "Zimbabwe", F],
]

const BY_CODE = new Map(TABLE.map(([code, name, continent]) => [code, { code, name, continent }]))

export type Country = { code: string; name: string; continent: Continent }

/** The country of an ISO alpha-2 code (case-insensitive); null for one we don't know. */
export function country(code: string | null | undefined): Country | null {
  if (!code) return null
  const upper = code.trim().toUpperCase()
  // Gemini writes "UK" now and then; ISO says GB.
  return BY_CODE.get(upper === "UK" ? "GB" : upper) ?? null
}

export const countryName = (code: string | null | undefined) => country(code)?.name ?? code ?? ""

export const continentOf = (code: string | null | undefined): Continent | null => country(code)?.continent ?? null

/** Every country, A–Z by name. */
export const COUNTRIES: Country[] = [...BY_CODE.values()].sort((a, b) => a.name.localeCompare(b.name))

/** A place's name as a key: lower case, no accents or punctuation, "saint" and "st" alike. */
export function nameKey(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/\bmt\.?\s/g, "mount ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** A stable id for a place: its name key and country, e.g. "new-york-city-us". */
export function placeId(name: string, code: string) {
  return `${nameKey(name).replace(/\s+/g, "-").slice(0, 60)}-${(code || "xx").toLowerCase()}`
}
