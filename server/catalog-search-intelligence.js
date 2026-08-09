const MAX_SEARCH_TOKENS = 12;

const CORE_TERMS = [
  'airbox', 'alignment', 'analyzer', 'brake', 'brakes', 'caliper', 'camshaft', 'charger',
  'clutch', 'coil', 'coilpack', 'coilovers', 'coolant', 'cooling', 'crankshaft', 'differential',
  'disc', 'discs', 'downpipe', 'drivetrain', 'ecu', 'engine', 'exhaust', 'filter', 'filters',
  'flexfuel', 'fuel', 'gasket', 'gaskets', 'gauge', 'gearbox', 'harness', 'headers', 'ignition',
  'injector', 'injectors', 'intake', 'intercooler', 'manifold', 'motorsport', 'oil', 'pad', 'pads',
  'piston', 'pistons', 'plug', 'plugs', 'pump', 'radiator', 'racing', 'rod', 'rods', 'rotor',
  'rotors', 'sensor', 'service', 'shipping', 'shock', 'spark', 'spring', 'springs', 'strut',
  'supercharger', 'suspension', 'thermostat', 'tire', 'tires', 'transmission', 'turbo',
  'turbocharger', 'tuning', 'tyre', 'tyres', 'wheel', 'wheels', 'wiring',
  'audi', 'bmw', 'mercedes', 'mini', 'porsche', 'volkswagen', 'mhd', 'xhp', 'apr', 'kw',
  'b58', 'n55', 's55', 's58', 'm2', 'm3', 'm4', 'g80', 'g82', 'g87', 'f80', 'f82'
];

const TOKEN_ALIASES = new Map([
  ['break', ['brake']], ['breaks', ['brake']], ['braking', ['brake']],
  ['sparkplug', ['spark', 'plug']], ['sparkplugs', ['spark', 'plug']],
  ['coilpacks', ['coilpack']], ['downpipes', ['downpipe']], ['intercoolers', ['intercooler']],
  ['gearboxes', ['gearbox']], ['dif', ['differential']], ['diff', ['differential']],
  ['rims', ['wheel']], ['antifreeze', ['coolant']],
  ['\u0641\u0631\u0627\u0645\u0644', ['brake']], ['\u0645\u0643\u0627\u0628\u062d', ['brake']], ['\u0628\u0631\u064a\u0643', ['brake']],
  ['\u0641\u062d\u0645\u0627\u062a', ['brake', 'pad']], ['\u062f\u0633\u0643\u0627\u062a', ['brake', 'disc']],
  ['\u0645\u062d\u0631\u0643', ['engine']], ['\u0645\u0643\u064a\u0646\u0629', ['engine']], ['\u0645\u0643\u064a\u0646\u0647', ['engine']],
  ['\u062a\u064a\u0631\u0628\u0648', ['turbo']], ['\u062a\u0648\u0631\u0628\u0648', ['turbo']],
  ['\u0627\u0646\u062a\u0631\u0643\u0648\u0644\u0631', ['intercooler']], ['\u0641\u0644\u062a\u0631', ['filter']], ['\u0641\u0644\u0627\u062a\u0631', ['filter']],
  ['\u0639\u0627\u062f\u0645', ['exhaust']], ['\u0627\u0643\u0632\u0648\u0632', ['exhaust']], ['\u0647\u062f\u0631\u0632', ['header']],
  ['\u0642\u064a\u0631', ['transmission']], ['\u062c\u064a\u0631', ['transmission']], ['\u0643\u0644\u062a\u0634', ['clutch']],
  ['\u062a\u0639\u0644\u064a\u0642', ['suspension']], ['\u0643\u0648\u064a\u0644\u0648\u0641\u0631', ['coilover']],
  ['\u062a\u0628\u0631\u064a\u062f', ['cooling']], ['\u0631\u062f\u064a\u062a\u0631', ['radiator']], ['\u0631\u0627\u062f\u064a\u062a\u0631', ['radiator']],
  ['\u0648\u0642\u0648\u062f', ['fuel']], ['\u0628\u0646\u0632\u064a\u0646', ['fuel']], ['\u0628\u062e\u0627\u062e\u0627\u062a', ['injector']],
  ['\u0628\u0631\u0645\u062c\u0629', ['tuning']], ['\u0643\u0645\u0628\u064a\u0648\u062a\u0631', ['ecu']],
  ['\u0628\u0648\u0627\u062c\u064a', ['spark', 'plug']], ['\u0643\u0648\u064a\u0644\u0627\u062a', ['ignition', 'coil']],
  ['\u062c\u0646\u0648\u0637', ['wheel']], ['\u0643\u0641\u0631\u0627\u062a', ['tyre']], ['\u0635\u064a\u0627\u0646\u0629', ['service']]
]);

const EQUIVALENT_TERMS = [
  ['tire', 'tires', 'tyre', 'tyres'],
  ['disc', 'discs', 'rotor', 'rotors'],
  ['gearbox', 'transmission'],
  ['wheel', 'wheels', 'rim', 'rims'],
  ['shock', 'shocks', 'damper', 'dampers', 'strut', 'struts'],
  ['coilpack', 'coilpacks'],
  ['downpipe', 'downpipes'],
  ['intercooler', 'intercoolers'],
  ['filter', 'filters'],
  ['injector', 'injectors'],
  ['piston', 'pistons'],
  ['gasket', 'gaskets'],
  ['plug', 'plugs'],
  ['pad', 'pads'],
  ['spring', 'springs']
];

const EQUIVALENTS = new Map();
for (const group of EQUIVALENT_TERMS) {
  for (const term of group) EQUIVALENTS.set(term, group);
}

export function normalizeCatalogSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function catalogSearchTokens(value) {
  return normalizeCatalogSearchText(value).split(' ').filter(Boolean);
}

function damerauLevenshteinWithin(left, right, maximum) {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  if (Math.abs(leftCharacters.length - rightCharacters.length) > maximum) return maximum + 1;
  let previousPrevious = null;
  let previous = Array.from({ length: rightCharacters.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= leftCharacters.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= rightCharacters.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]
        + (leftCharacters[leftIndex - 1] === rightCharacters[rightIndex - 1] ? 0 : 1);
      let distance = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, substitution);
      if (previousPrevious && leftIndex > 1 && rightIndex > 1
        && leftCharacters[leftIndex - 1] === rightCharacters[rightIndex - 2]
        && leftCharacters[leftIndex - 2] === rightCharacters[rightIndex - 1]) {
        distance = Math.min(distance, previousPrevious[rightIndex - 2] + 1);
      }
      current[rightIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[rightCharacters.length];
}

export function catalogSearchVocabulary(documents = []) {
  const vocabulary = new Map(CORE_TERMS.map(term => [term, 10_000]));
  for (const document of documents) {
    for (const token of catalogSearchTokens(document)) {
      if (token.length < 2 || token.length > 48) continue;
      vocabulary.set(token, (vocabulary.get(token) || 0) + 1);
    }
  }
  return vocabulary;
}

function correctedToken(vocabulary, token) {
  if (!vocabulary || vocabulary.has(token) || /\d/u.test(token) || Array.from(token).length < 4) return token;
  for (const candidate of vocabulary.keys()) {
    if (candidate.startsWith(token)) return token;
  }
  const length = Array.from(token).length;
  const maximum = length >= 8 ? 2 : 1;
  const firstCharacter = Array.from(token)[0];
  let best = null;
  for (const [candidate, frequency] of vocabulary) {
    const characters = Array.from(candidate);
    if (characters[0] !== firstCharacter || /\d/u.test(candidate)
      || Math.abs(characters.length - length) > maximum) continue;
    const distance = damerauLevenshteinWithin(token, candidate, maximum);
    if (distance > maximum) continue;
    if (!best || distance < best.distance
      || (distance === best.distance && frequency > best.frequency)
      || (distance === best.distance && frequency === best.frequency && candidate < best.term)) {
      best = { term: candidate, distance, frequency };
    }
  }
  return best?.term || token;
}

function tokenAlternatives(token, vocabulary) {
  const alternatives = new Set([token, ...(EQUIVALENTS.get(token) || [])]);
  const singular = token.endsWith('ies') && token.length > 4
    ? `${token.slice(0, -3)}y`
    : (token.endsWith('s') && !token.endsWith('ss') && token.length > 4 ? token.slice(0, -1) : '');
  const plural = token.endsWith('y') && token.length > 3 ? `${token.slice(0, -1)}ies` : `${token}s`;
  if (singular && (!vocabulary || vocabulary.has(singular))) alternatives.add(singular);
  if (!token.endsWith('s') && (!vocabulary || vocabulary.has(plural))) alternatives.add(plural);
  return [...alternatives].filter(value => value && value.length <= 48);
}

export function buildCatalogSearchPlan(query, { vocabulary = null } = {}) {
  const normalizedQuery = normalizeCatalogSearchText(query);
  const originalTokens = catalogSearchTokens(normalizedQuery);
  if (!originalTokens.length || originalTokens.length > MAX_SEARCH_TOKENS) {
    return {
      query: String(query || ''), normalizedQuery, originalTokens, canonicalTokens: [], canonicalQuery: '',
      translated: false, corrected: false, corrections: [], tokenGroups: [], prefixTsQuery: ''
    };
  }
  const expanded = [];
  const corrections = [];
  let translated = false;
  for (const token of originalTokens) {
    const alias = TOKEN_ALIASES.get(token);
    if (!alias) {
      expanded.push(token);
      continue;
    }
    expanded.push(...alias);
    const to = alias.join(' ');
    if (to !== token) corrections.push({ from: token, to });
    if (/[\u0600-\u06ff]/u.test(token)) translated = true;
  }
  const canonicalTokens = [];
  for (const token of expanded) {
    const corrected = correctedToken(vocabulary, token);
    if (!canonicalTokens.includes(corrected)) canonicalTokens.push(corrected);
    if (corrected !== token) corrections.push({ from: token, to: corrected });
  }
  const uniqueCorrections = [...new Map(corrections.map(item => [`${item.from}\u0000${item.to}`, item])).values()];
  const tokenGroups = canonicalTokens.map(token => tokenAlternatives(token, vocabulary));
  const prefixTsQuery = tokenGroups.map(group => {
    const terms = [...new Set(group.map(value => normalizeCatalogSearchText(value)).filter(Boolean))];
    return terms.length > 1 ? `(${terms.map(term => `${term}:*`).join(' | ')})` : `${terms[0]}:*`;
  }).filter(Boolean).join(' & ');
  return {
    query: String(query || ''), normalizedQuery, originalTokens, canonicalTokens,
    canonicalQuery: canonicalTokens.join(' '), translated,
    corrected: uniqueCorrections.length > 0, corrections: uniqueCorrections, tokenGroups, prefixTsQuery
  };
}

export function catalogSearchMeta(plan) {
  return {
    canonicalQuery: plan?.canonicalQuery || plan?.normalizedQuery || null,
    translated: Boolean(plan?.translated), corrected: Boolean(plan?.corrected),
    corrections: Array.isArray(plan?.corrections) ? plan.corrections : []
  };
}
