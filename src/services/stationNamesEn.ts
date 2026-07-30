/**
 * English display names for Serbian toll stations / petlje.
 * Unknown names fall back to a light Latin transliteration.
 */

const EXACT_EN: Record<string, string> = {
  beograd: 'Belgrade',
  'ns beograd': 'Belgrade',
  preševo: 'Presevo',
  presevo: 'Presevo',
  niš: 'Nis',
  nis: 'Nis',
  'niš jug': 'Nis South',
  'nis jug': 'Nis South',
  'niš sever': 'Nis North',
  'nis sever': 'Nis North',
  'niš istok': 'Nis East',
  'nis istok': 'Nis East',
  'niš malča': 'Nis Malca',
  'nis malca': 'Nis Malca',
  'novi sad': 'Novi Sad',
  subotica: 'Subotica',
  'šimanovci': 'Simanovci',
  simanovci: 'Simanovci',
  'stara pazova': 'Stara Pazova',
  'velika plana': 'Velika Plana',
  'mali požarevac': 'Mali Pozarevac',
  'mali pozarevac': 'Mali Pozarevac',
  požarevac: 'Pozarevac',
  pozarevac: 'Pozarevac',
  smederevo: 'Smederevo',
  jagodina: 'Jagodina',
  ćuprija: 'Cuprija',
  cuprija: 'Cuprija',
  paraćin: 'Paracin',
  paracin: 'Paracin',
  aleksinac: 'Aleksinac',
  'aleksinački rudnici': 'Aleksinac Mines',
  'aleksinacki rudnici': 'Aleksinac Mines',
  leskovac: 'Leskovac',
  'leskovac centar': 'Leskovac Center',
  'leskovac jug': 'Leskovac South',
  vranje: 'Vranje',
  'bujanovac sever': 'Bujanovac North',
  'bujanovac jug': 'Bujanovac South',
  'vladičin han': 'Vladicin Han',
  'vladicin han': 'Vladicin Han',
  dimitrovgrad: 'Dimitrovgrad',
  'petlja batajnica': 'Batajnica interchange',
  'petlja beograd': 'Belgrade interchange',
  'petlja surčin': 'Surcin interchange',
  'petlja surcin': 'Surcin interchange',
  'petlja surčin jug': 'Surcin South interchange',
  'petlja surcin jug': 'Surcin South interchange',
  'petlja ostružnica': 'Ostruznica interchange',
  'petlja ostruznica': 'Ostruznica interchange',
  'petlja orlovača': 'Orlovaca interchange',
  'petlja orlovaca': 'Orlovaca interchange',
  'petlja avala': 'Avala interchange',
  'petlja bubanj potok': 'Bubanj Potok interchange',
}

function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Strip pricing suffix / NS prefix for lookup. */
function bareStation(name: string): string {
  return name
    .replace(/\s*\(cena kao[^)]*\)\s*/gi, '')
    .replace(/^NS\s+/i, '')
    .trim()
}

function transliterate(name: string): string {
  const map: Record<string, string> = {
    č: 'c',
    ć: 'c',
    š: 's',
    ž: 'z',
    đ: 'dj',
    Č: 'C',
    Ć: 'C',
    Š: 'S',
    Ž: 'Z',
    Đ: 'Dj',
  }
  return name.replace(/[čćšžđČĆŠŽĐ]/g, (ch) => map[ch] ?? ch)
}

export function stationNameEn(name: string): string {
  const bare = bareStation(name)
  if (!bare) return bare
  const key = normalizeKey(bare)
  if (EXACT_EN[key]) return EXACT_EN[key]
  const withoutPetlja = key.replace(/^petlja\s+/, '')
  if (EXACT_EN[withoutPetlja]) return EXACT_EN[withoutPetlja]
  if (EXACT_EN[`petlja ${withoutPetlja}`]) return EXACT_EN[`petlja ${withoutPetlja}`]
  return transliterate(bare)
}

export function routeLabelEn(from: string, to: string): string {
  return `${stationNameEn(from)} → ${stationNameEn(to)}`
}

export function rampsLabelEn(stations: string[]): string {
  return stations.map(stationNameEn).join(' → ')
}
