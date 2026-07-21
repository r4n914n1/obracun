import fs from 'fs'

const API_URL =
  'https://www.putevi-srbije.rs/index.php?option=com_ajax&plugin=istorelocator&tmpl=component&format=json&showDirections=primary&lat=0&lng=0&maxdistance=6367&limit=123456&source=csv&file=naplatne-stanice.csv&category='

const response = await fetch(API_URL, {
  method: 'POST',
  headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
})

if (!response.ok) {
  throw new Error(`HTTP ${response.status}`)
}

const raw = await response.json()
if (!raw.success || !raw.data?.[0]?.locations) {
  throw new Error('API nije vratio lokacije')
}

const locations = raw.data[0].locations.map((loc, i) => ({
  id: String(loc.id || '').trim() || `gen-${i + 1}`,
  name: loc.name.trim(),
  lat: Number(String(loc.lat).trim()),
  lng: Number(String(loc.lng).trim()),
  road: (loc.address || '').trim(),
  city: (loc.city || '').trim() || null,
  country: (loc.country || '').trim() || null,
}))

locations.sort((a, b) => a.name.localeCompare(b.name, 'sr'))

fs.mkdirSync('src/data', { recursive: true })
fs.mkdirSync('public/data', { recursive: true })

const payload = {
  source:
    'https://www.putevi-srbije.rs/index.php/mapa-naplatnih-stanica-1',
  extractedAt: new Date().toISOString(),
  count: locations.length,
  stations: locations,
}

const json = JSON.stringify(payload, null, 2)
fs.writeFileSync('src/data/naplatne-stanice.json', json, 'utf8')
fs.writeFileSync('public/data/naplatne-stanice.json', json, 'utf8')

const csvHeader = 'id,name,lat,lng,road,city,country'
const csvRows = locations.map((s) =>
  [
    s.id,
    `"${s.name.replace(/"/g, '""')}"`,
    s.lat,
    s.lng,
    `"${s.road.replace(/"/g, '""')}"`,
    s.city ? `"${s.city}"` : '',
    s.country ? `"${s.country}"` : '',
  ].join(','),
)
const csv = [csvHeader, ...csvRows].join('\n')
fs.writeFileSync('src/data/naplatne-stanice.csv', csv, 'utf8')
fs.writeFileSync('public/data/naplatne-stanice.csv', csv, 'utf8')

console.log(`Extracted ${locations.length} toll stations`)
