import type { Agent, HQState, LogEntry } from './types'

// A scripted campaign, three generations deep. State is a pure function of time, so it loops cleanly.
// Codenames only (MARINA, HEALTH, ATLAS, PANTER, CHAPA): no client names, no real figures.
type Row = [id: string, parent: string | null, area: string, description: string, start: number, dur: number, fails?: boolean]

const ROWS: Row[] = [
  ['marina', null, 'originacion', 'Ficha comercial · MARINA', 2, 40],
  ['marina-sabi', 'marina', 'otros', 'SABI de MARINA', 5, 12],
  ['marina-comp', 'marina', 'otros', 'Comparables náuticos', 8, 20],
  ['marina-prec', 'marina-comp', 'otros', 'Precedentes 2021–2026', 11, 10],
  ['health', null, 'encargos', 'One-pager · HEALTH', 3, 26],
  ['presc', null, 'prescriptores', '20 candidatos a prescriptor', 5, 48],
  ['presc-li', 'presc', 'otros', 'Perfiles de referencia', 9, 18],
  ['presc-lev', 'presc', 'otros', 'Despachos de Levante', 10, 16],
  ['presc-crit', 'presc', 'otros', 'Criterios oro · plata · bronce', 14, 12],
  ['atlas', null, 'deals', 'Ordenar data room · ATLAS', 6, 15, true],
  ['atlas-2', null, 'deals', 'Reintento · ATLAS por copia', 23, 24],
  ['atlas-idx', 'atlas-2', 'otros', 'Índice del data room', 26, 10],
  ['lander', null, 'automatizacion', 'Deal Lander · búsqueda profunda', 8, 52],
  ['lander-pb', 'lander', 'otros', 'Conector PitchBook', 12, 22],
  ['lander-api', 'lander-pb', 'otros', 'Límites de la API', 15, 9],
  ['lander-test', 'lander', 'otros', 'Tests de integración', 30, 16],
  ['fondos', null, 'originacion', 'Skill de análisis para fondos', 12, 40],
  ['fondos-sk', 'fondos', 'otros', 'Skills existentes', 15, 10],
  ['fondos-tpl', 'fondos', 'otros', 'Plantilla de informe', 22, 18],
  ['propuestas', null, 'encargos', 'Propuestas de compra y venta', 16, 30],
  ['formacion', null, 'formacion', 'Sesión de formación nº1', 20, 34],
  ['form-enc', 'formacion', 'otros', 'Encuesta de uso de IA', 23, 10],
  ['panter', null, 'ov', 'Herramienta de costes · PANTER', 26, 36],
  ['panter-m', 'panter', 'otros', 'Modelo 02_Maestro', 29, 20],
  ['radar', null, 'originacion', 'Radar sectorial España', 32, 36],
  ['radar-cnae', 'radar', 'otros', 'Fragmentación por CNAE', 35, 14],
  ['radar-cons', 'radar', 'otros', 'Consolidadores activos', 36, 16],
  ['radar-top', 'radar-cons', 'otros', 'Top 10 sin presencia en España', 40, 12],
  ['chapa', null, 'deals', 'Compradores build-up · CHAPA', 38, 30],
  ['chapa-f', 'chapa', 'otros', 'Filtrar por tamaño', 42, 16],
  ['chapa-s', 'chapa', 'otros', 'Targets en SABI', 44, 18],
]

const TOOLS: Record<string, [string, string][]> = {
  originacion: [['Skill', 'ficha-comercial-ma'], ['pitchbook_search', 'sector · España'], ['pitchbook_get_company_deals', 'comparables'], ['WebSearch', 'noticias del sector'], ['Write', 'informe.pdf']],
  encargos: [['Read', 'resumen.docx'], ['Skill', 'infografias-ma'], ['Bash', 'render'], ['Write', 'onepager.pdf']],
  prescriptores: [['WebSearch', 'asesores M&A'], ['contacts_search', 'socios de despacho'], ['Write', 'candidatos.xlsx']],
  deals: [['Glob', 'data room/**'], ['Read', 'índice.xlsx'], ['Bash', 'copiar a 02_Financiero'], ['Edit', 'índice.xlsx']],
  automatizacion: [['Read', 'src/search.ts'], ['Grep', 'deepResearch'], ['Edit', 'search.ts'], ['Bash', 'npm test']],
  formacion: [['Skill', 'pildora-formacion-implica'], ['Read', 'encuesta.xlsx'], ['Write', 'sesion_1.pptx']],
  ov: [['Read', '02_Maestro.xlsx'], ['Bash', 'python costes.py'], ['Write', 'herramienta_costes.xlsx']],
  otros: [['Glob', '**/*'], ['Grep', 'EBITDA'], ['Read', 'fuente.csv'], ['WebFetch', 'documentación']],
}

const VOICE: Record<string, string[]> = {
  originacion: ['Separando hechos de hipótesis antes de afirmar nada.', 'Triangulo cada múltiplo con dos fuentes.', 'Marco como pendiente lo que no puedo verificar.'],
  encargos: ['Versión ciega: solo codename.', 'Siete bloques, una página.'],
  prescriptores: ['Aplicando los criterios oro, plata y bronce.', 'Descarto perfiles sin operaciones recientes.'],
  deals: ['Clasificando documentos por bloque del data room.', 'Copio en lugar de mover: nada se borra.'],
  automatizacion: ['Porto la búsqueda profunda al MVP.', 'Los tests pasan. Sin push hasta tu visto bueno.'],
  formacion: ['Tres bloques: seguridad, casos reales, práctica.'],
  ov: ['Reconstruyo la estructura de costes por centro.'],
  otros: ['Buscando la fuente correcta.', 'Extraigo solo lo que me han pedido.'],
}

const AREA_LABEL: Record<string, string> = { deals: 'Deals', originacion: 'Originación', encargos: 'Encargos', automatizacion: 'Automatización', prescriptores: 'Prescriptores', formacion: 'Formación IA', ov: 'Operating Value', otros: 'Apoyo' }
const LOOP = 96

const promptFor = (task: string, area: string, isChild: boolean) =>
  `${isChild ? 'Subtarea' : 'Tarea'}: ${task}
Área: ${area}

Contexto: viene del plan de trabajo de hoy. Trabaja solo con codenames; no escribas nombres de cliente.
Cita la fuente de cada dato (SABI, PitchBook, BORME o precedente público) y marca como pendiente lo que no puedas verificar.
No envíes nada a nadie: deja borradores.

Entrega: en 3-5 líneas, qué hiciste, la ruta completa de cada archivo y qué queda pendiente.`

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

export function demoState(t0: number, now: number): HQState {
  const el = ((now - t0) / 1000) % LOOP
  const base = now - el * 1000
  const at = (s: number) => base + s * 1000

  const agents: Agent[] = ROWS.filter(r => el >= r[4]).map(([id, parent, area, description, start, dur, fails]) => {
    const end = start + dur
    const isLive = el < end
    const upto = Math.min(el, end)
    const every = 1.4 + (hash(id) % 12) / 10
    const pool = TOOLS[area]
    const log: LogEntry[] = []
    for (let k = 0, t = start + 0.6; t <= upto; k++, t += every) {
      const [tool, detail] = pool[(k + hash(id)) % pool.length]
      log.push({ t: at(t), tool, detail })
    }
    const lines = VOICE[area]
    const live = upto - start
    const line = lines[Math.floor(live / 6) % lines.length]
    return {
      id, type: area === 'otros' ? 'Explore' : `orquestador:${area}`, area: AREA_LABEL[area], areaKey: area, description,
      status: isLive ? 'running' : fails ? 'failed' : 'completed',
      parentId: parent ?? undefined, tool: isLive ? log[log.length - 1]?.tool : undefined, calls: log.length,
      startedAt: at(start), endedAt: isLive ? undefined : at(end), log,
      voice: isLive ? line.slice(0, Math.floor((live % 6) * 30)) : '',
      answer: isLive ? undefined : fails ? 'Seis archivos bloqueados por la sincronización. No he movido nada.' : `${description}: listo. Fuentes citadas y pendientes marcados.`,
      usage: { input: Math.round(live * 2600), output: Math.round(live * 380), cacheRead: Math.round(live * 8800), model: 'claude-sonnet-5-5' },
      convo: [{ t: at(start), from: parent ? 'agente padre' : 'Napoleon', text: promptFor(description, AREA_LABEL[area], !!parent) }],
    }
  })

  const spawns = ROWS.filter(r => !r[1] && el >= r[4] - 0.8)
  const napLog: LogEntry[] = [{ t: at(0.4), tool: 'Read', detail: 'Plan de trabajo IMPLICA.xlsx' }, ...spawns.map(r => ({ t: at(r[4] - 0.8), tool: 'Agent', detail: r[3] }))]
  const isDelegating = ROWS.some(r => !r[1] && el >= r[4] - 0.8 && el < r[4] + 0.6)
  const napVoice = el < 10 ? 'Doce tareas en el plan de hoy. Las reparto por área.' : el > 21 && el < 26 ? 'ATLAS ha caído. Relanzo con otra táctica.' : el > 76 ? 'Campaña cerrada. Preparo el resumen.' : ''
  // Codex, connected as a peer, asks Napoleon for context halfway through the campaign
  const codexAsk = { t: at(18), from: 'Codex', text: '¿Qué criterios de comprador usa IMPLICA para un build-up industrial? Los necesito para el filtro del script de Deal Lander.', status: 'en cola' }
  const codexReply = { t: at(27), from: 'Napoleon', text: 'Mayoría o integración total; facturación del comprador ≥ 3× la del target; operaciones de M&A en los últimos 5 años; presencia o interés declarado en España. Fuente: criterios internos del área de Originación.', status: 'a Codex' }
  const convo = el >= 27 ? [codexAsk, codexReply] : el >= 18 ? [codexAsk] : []
  const peers = el >= 18 ? [{ name: 'Codex', firstSeen: at(18), lastSeen: at(el >= 27 ? 27 : 18), isWaiting: el < 27, count: 1 }] : []

  return {
    v: 1, updatedAt: now, sessionStart: base, peers,
    napoleon: { tool: isDelegating ? 'Agent' : undefined, calls: napLog.length, log: napLog, voice: napVoice, convo, usage: { input: Math.round(el * 5200), output: Math.round(el * 300), cacheRead: Math.round(el * 30000), model: 'claude-opus-5-5' } },
    agents,
  }
}
