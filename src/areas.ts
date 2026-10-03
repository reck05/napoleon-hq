// one entry per sheet of "Plan de trabajo IMPLICA.xlsx"; keys match the mod's agent types (orquestador:<key>).
// Color is used sparingly: a 5px dot per agent, nothing else.
export type Area = { key: string; label: string; color: string }

export const AREAS: Area[] = [
  { key: 'deals', label: 'Deals', color: '#ff6b9a' },
  { key: 'originacion', label: 'Originación', color: '#5aa9ff' },
  { key: 'encargos', label: 'Encargos', color: '#f2b84b' },
  { key: 'automatizacion', label: 'Automatización', color: '#a98bff' },
  { key: 'prescriptores', label: 'Prescriptores', color: '#4fd18b' },
  { key: 'formacion', label: 'Formación IA', color: '#4fd4dc' },
  { key: 'ov', label: 'Operating Value', color: '#ff8a65' },
  { key: 'otros', label: 'Apoyo', color: '#9a9a9a' },
  { key: 'peer', label: 'Conexiones', color: '#ffffff' },
]

export const areaOf = (key: string) => AREAS.find(a => a.key === key) ?? AREAS[AREAS.length - 1]
