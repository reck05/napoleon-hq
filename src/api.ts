export async function post<T = { ok: boolean }>(url: string, body: unknown = {}): Promise<T> {
  const token = document.querySelector<HTMLMetaElement>('meta[name="hq-token"]')?.content ?? ''
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hq-token': token }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`)
  return data
}
