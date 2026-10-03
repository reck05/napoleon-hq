// Bound data received from paired computers before parsing or forwarding it.
export async function readRemoteJSON(response, { maxBytes = 2 * 1024 * 1024 } = {}) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new Error('La respuesta remota supera el límite permitido')
  }
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > maxBytes) throw new Error('La respuesta remota supera el límite permitido')
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
}

export async function* readRemoteEvents(response, { controller, maxFrameBytes = 8 * 1024 * 1024, idleMs = 45000 } = {}) {
  if (!response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('El equipo remoto no devolvió eventos válidos')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let expired = false
  let timer
  const deadline = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      expired = true
      controller?.abort()
      void reader.cancel().catch(() => {})
    }, idleMs)
  }
  deadline()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (expired) throw new Error('El equipo remoto dejó de enviar eventos completos')
      if (done) break
      pending += decoder.decode(value, { stream: true })
      let end
      while ((end = pending.indexOf('\n\n')) !== -1) {
        const event = pending.slice(0, end)
        if (Buffer.byteLength(event) > maxFrameBytes) throw new Error('El evento remoto supera el límite permitido')
        pending = pending.slice(end + 2)
        deadline()
        yield event
      }
      if (Buffer.byteLength(pending) > maxFrameBytes) throw new Error('El evento remoto supera el límite permitido')
    }
  } finally {
    clearTimeout(timer)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
