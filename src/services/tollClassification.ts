import type { ForeignTollFare } from '../types'
import tunnelSystems from '../data/tunnel-systems.json'

const TUNNEL_HINT =
  /tunnel|tunel|tünel|traforo|galleria|galerie|galerija|predor|mont[\s-]?blanc|monte[\s-]?bianco|karawan|karavan|frejus|fréjus|tauern|gotthard|arlberg|brenner|vielha|karawanken|karavanken|san[\s-]?bernardino|gran[\s-]?san[\s-]?bernardo|great[\s-]?st[\s-]?bernard|munt[\s-]?la[\s-]?schera|vereina/i

const NORMALIZED_OPERATORS = (tunnelSystems.operators as string[]).map(
  normalizeTollText,
)

function normalizeTollText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tunnel vs highway toll — keywords + known operators (e.g. SITAF = Fréjus). */
export function classifyForeignTollKind(
  name: string,
  system: string,
): ForeignTollFare['kind'] {
  const text = normalizeTollText(`${name} ${system}`)
  if (!text) return 'toll'

  if (TUNNEL_HINT.test(text)) return 'tunnel'

  for (const operator of NORMALIZED_OPERATORS) {
    if (operator && text.includes(operator)) return 'tunnel'
  }

  return 'toll'
}

/** Display label for foreign toll line items. */
export function foreignTollDisplayName(
  name: string,
  system: string,
  kind: ForeignTollFare['kind'],
): string {
  const trimmedName = name.trim()
  const trimmedSystem = system.trim()
  if (kind === 'tunnel' && trimmedSystem && trimmedSystem !== trimmedName) {
    return `${trimmedName} (${trimmedSystem})`
  }
  return trimmedName || trimmedSystem
}
