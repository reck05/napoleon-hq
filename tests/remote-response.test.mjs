import test from 'node:test'
import assert from 'node:assert/strict'
import { readRemoteJSON, readRemoteEvents } from '../remote-response.mjs'

function response(chunks, headers = {}) {
  let cancelled = false
  let index = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(Buffer.from(chunks[index++]))
      else controller.close()
    },
    cancel() { cancelled = true },
  })
  return { value: new Response(stream, { headers }), cancelled: () => cancelled }
}

test('remote JSON is bounded even without a Content-Length header', async () => {
  assert.deepEqual(await readRemoteJSON(response(['{"ok":', 'true}']).value), { ok: true })
  const oversized = response(['{"text":"', 'x'.repeat(128), '"}'])
  await assert.rejects(readRemoteJSON(oversized.value, { maxBytes: 64 }), /límite/)
  assert.equal(oversized.cancelled(), true)
  const advertised = response(['{}'], { 'content-length': '1000' })
  await assert.rejects(readRemoteJSON(advertised.value, { maxBytes: 64 }), /límite/)
  assert.equal(advertised.cancelled(), true)
})

test('remote events preserve split UTF-8, reject oversized frames and close the upstream', async () => {
  const bytes = Buffer.from('event: state\ndata: café\n\n: ping\n\n')
  const split = bytes.indexOf(0xc3) + 1
  const frames = []
  for await (const event of readRemoteEvents(response([bytes.subarray(0, split), bytes.subarray(split)], { 'content-type': 'text/event-stream' }).value)) frames.push(event)
  assert.deepEqual(frames, ['event: state\ndata: café', ': ping'])
  for (const chunks of [['x'.repeat(65), 'more'], ['x'.repeat(65) + '\n\n', 'more']]) {
    const remote = response(chunks, { 'content-type': 'text/event-stream' })
    await assert.rejects(async () => { for await (const event of readRemoteEvents(remote.value, { maxFrameBytes: 64 })) assert.fail(event) }, /límite/)
    assert.equal(remote.cancelled(), true)
  }
})

test('incomplete remote events cannot keep a connection alive by dripping bytes', async () => {
  let timer, cancelled = false
  const controller = new AbortController()
  const remote = new Response(new ReadableStream({
    start(stream) { timer = setInterval(() => stream.enqueue(Buffer.from('x')), 5) },
    cancel() { cancelled = true; clearInterval(timer) },
  }), { headers: { 'content-type': 'text/event-stream' } })
  await assert.rejects(async () => { for await (const event of readRemoteEvents(remote, { controller, idleMs: 40 })) assert.fail(event) }, /eventos completos/)
  assert.equal(cancelled, true)
  assert.equal(controller.signal.aborted, true)
})
