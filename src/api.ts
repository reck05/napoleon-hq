export async function post<T = { ok: boolean }>(url: string, body: unknown = {}): Promise<T> {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="hq-token"]')
  const send = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hq-token': meta?.content ?? '' }, body: JSON.stringify(body) })
  let response = await send()
  // A managed restart changes the CSRF token. A rejected request has performed no action.
  if (response.status === 403) {
    const session = await fetch('/api/session')
    if (session.ok) {
      const { token } = await session.json()
      if (meta && typeof token === 'string') { meta.content = token; response = await send() }
    }
  }
  const data = await response.json()
  if (response.status === 401) throw new Error('Vuelve a abrir tu enlace privado para conectar con Napoleon.')
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`)
  return data
}
