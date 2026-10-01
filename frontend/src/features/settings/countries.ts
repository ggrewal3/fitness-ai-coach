// Officially assigned ISO 3166-1 alpha-2 codes accepted by the backend.
// Mirrors backend/src/modules/account/countryCodes.ts (249 codes), which stays
// authoritative; display names come from the browser via Intl.DisplayNames.
const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
] as const

export type CountryOption = { code: string; name: string }

// A few common names that differ from the official ISO short names.
const SEARCH_ALIASES: Record<string, string[]> = {
  GB: ['uk', 'united kingdom', 'great britain', 'britain', 'england', 'scotland', 'wales'],
  US: ['usa', 'united states', 'america'],
  AE: ['uae', 'emirates'],
  KR: ['south korea'],
  KP: ['north korea'],
  NL: ['holland'],
  CZ: ['czech republic'],
}

let cachedOptions: CountryOption[] | null = null

function displayNames(): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region', fallback: 'code' })
  } catch {
    return null
  }
}

/** Every supported country, sorted by display name in the user's locale. */
export function getCountryOptions(): CountryOption[] {
  if (!cachedOptions) {
    const names = displayNames()
    cachedOptions = COUNTRY_CODES.map((code) => ({ code, name: names?.of(code) ?? code })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )
  }

  return cachedOptions
}

export function getCountryName(code: string | null): string {
  if (!code) {
    return ''
  }

  return getCountryOptions().find((option) => option.code === code)?.name ?? code
}

export function isSupportedCountryCode(code: string): boolean {
  return getCountryOptions().some((option) => option.code === code)
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Ranks exact code/alias > name prefix > word prefix > alias prefix > substring. */
export function searchCountries(query: string): CountryOption[] {
  const options = getCountryOptions()
  const q = normalizeSearch(query)

  if (!q) {
    return options
  }

  const ranked: { option: CountryOption; rank: number }[] = []

  for (const option of options) {
    const name = normalizeSearch(option.name)
    const aliases = SEARCH_ALIASES[option.code] ?? []
    let rank = -1

    if (option.code.toLowerCase() === q || aliases.includes(q)) rank = 0
    else if (name.startsWith(q)) rank = 1
    else if (name.split(/[\s,()-]+/).some((word) => word.startsWith(q))) rank = 2
    else if (aliases.some((alias) => alias.startsWith(q))) rank = 3
    else if (name.includes(q)) rank = 4

    if (rank >= 0) {
      ranked.push({ option, rank })
    }
  }

  return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.option)
}
