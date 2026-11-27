// Home stop button: the late events of a question that left the screen never reopen a bubble or close the next one.
// site/assets/turn-ids.js is served as a browser module; it is copied to a .mjs file so node loads it as ESM.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

async function loadTurnIds() {
  const target = join(mkdtempSync(join(tmpdir(), 'lab019-turn-ids-')), 'turn-ids.mjs')
  copyFileSync(fileURLToPath(new URL('../../site/assets/turn-ids.js', import.meta.url)), target)
  return (await import(pathToFileURL(target).href)).createTurnIds
}

test('c3: events of a stopped question stay off the screen; the next question is never closed by them', async () => {
  const createTurnIds = await loadTurnIds()
  const cases = [
    {
      name: 'stop closed the question here (stop came before the run started, or failed): its stream is dropped',
      steps: (ids) => { ids.start('m1'); ids.drop() },
      events: [[{ messageId: 'm1', delta: 'late' }, true], [{ messageId: 'm1', stopped: false }, true]],
    },
    {
      name: 'a new question after the stop: the old done does not close it, its own events show',
      steps: (ids) => { ids.start('m1'); ids.drop(); ids.start('m2') },
      events: [[{ messageId: 'm1' }, true], [{ messageId: 'm2', delta: 'hi' }, false], [{ messageId: 'm2' }, false]],
    },
    {
      name: 'new question still waiting for send(): the old run is dropped, the new one is not',
      steps: (ids) => { ids.start('m1'); ids.drop() },
      events: [[{ messageId: 'm1', delta: 'late' }, true], [{ messageId: 'm2', delta: 'early' }, false]],
    },
    {
      name: 'question on screen: events of another question are not its own',
      steps: (ids) => { ids.start('m2') },
      events: [[{ messageId: 'm9', delta: 'x' }, true], [{ messageId: 'm2', delta: 'y' }, false]],
    },
    {
      name: 'closed before send() answered: that id is dropped without touching the question on screen',
      steps: (ids) => { ids.start('m3'); ids.drop('m1') },
      events: [[{ messageId: 'm1' }, true], [{ messageId: 'm3', delta: 'z' }, false]],
    },
    {
      name: 'events without a messageId are never dropped',
      steps: (ids) => { ids.start('m1'); ids.drop() },
      events: [[{ delta: 'x' }, false], [null, false]],
    },
  ]
  for (const { name, steps, events } of cases) {
    const ids = createTurnIds()
    steps(ids)
    for (const [event, stale] of events) assert.equal(ids.stale(event), stale, `${name}: ${JSON.stringify(event)}`)
  }
})
