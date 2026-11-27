// Home chat controls: the stop retry (c3), the send/stop button of the stage and of the bubble (c4), and the corner
// bubble with the "Minimizar" memory (c5). site/assets/home-controls.js is served as a browser module; it is copied
// to a .mjs file so node loads it as ESM.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

async function loadControls() {
  const target = join(mkdtempSync(join(tmpdir(), 'lab019-home-controls-')), 'home-controls.mjs')
  copyFileSync(fileURLToPath(new URL('../../site/assets/home-controls.js', import.meta.url)), target)
  return import(pathToFileURL(target).href)
}

const { askStop, sendButtons, bubble, minimizedStore } = await loadControls()

test('c3: one click asks the gateway to stop once, and once more only when the run was not registered yet', async () => {
  const cases = [
    { name: 'the run stops at once', answers: [{ stopped: true }], calls: 1, waits: [], stopped: true },
    { name: 'no run yet, then stopped', answers: [{ stopped: false }, { stopped: true }], calls: 2, waits: [700], stopped: true },
    { name: 'never stopped: two asks and no more', answers: [{ stopped: false }, { stopped: false }, { stopped: true }], calls: 2, waits: [700], stopped: false },
    { name: 'the stop does not reach the gateway', answers: [new Error('offline'), new Error('offline')], calls: 2, waits: [700], stopped: false },
    { name: 'the answer ended meanwhile: no second ask', answers: [{ stopped: false }], mineFor: 1, calls: 1, waits: [], stopped: false },
    { name: 'a new question took the screen before the first ask', answers: [{ stopped: true }], mineFor: 0, calls: 0, waits: [], stopped: false },
  ]
  for (const { name, answers, mineFor = Infinity, calls, waits, stopped } of cases) {
    let made = 0
    const waited = []
    const stop = async () => {
      const answer = answers[made++]
      if (answer instanceof Error) throw answer
      return answer
    }
    const stillMine = () => made < mineFor
    const result = await askStop(stop, { stillMine, retryMs: 700, wait: async (ms) => waited.push(ms) })
    assert.equal(result, stopped, `${name}: result`)
    assert.equal(made, calls, `${name}: stop() calls`)
    assert.deepEqual(waited, waits, `${name}: waits`)
  }
})

test('c4: the send button of the stage and of the bubble turns into the same stop button while the agent answers', () => {
  const cases = [
    { name: 'idle, text typed', in: { busy: false, stopping: false, booting: false, hasText: true }, stop: false, stage: false, panel: false },
    { name: 'idle, nothing typed', in: { busy: false, stopping: false, booting: false, hasText: false }, stop: false, stage: true, panel: false },
    { name: 'history still loading', in: { busy: false, stopping: false, booting: true, hasText: true }, stop: false, stage: true, panel: false },
    { name: 'answering: both can stop, even with nothing typed', in: { busy: true, stopping: false, booting: false, hasText: false }, stop: true, stage: false, panel: false },
    { name: 'stopping: a second click does nothing', in: { busy: true, stopping: true, booting: false, hasText: true }, stop: true, stage: true, panel: true },
  ]
  for (const c of cases) {
    const state = sendButtons(c.in)
    assert.equal(state.face.stop, c.stop, `${c.name}: stop face`)
    assert.equal(state.face.icon, c.stop ? '#i-stop' : '#i-up', `${c.name}: icon`)
    assert.equal(state.face.label, c.stop ? 'stop' : 'send', `${c.name}: label`)
    assert.equal(state.stage.disabled, c.stage, `${c.name}: stage disabled`)
    assert.equal(state.panel.disabled, c.panel, `${c.name}: bubble disabled`)
  }
})

test('c5: minimized, the conversation lives in the corner bubble, even with the hero on screen', () => {
  const cases = [
    { name: 'no conversation yet', in: { hasConversation: false, minimized: false, stageVisible: false }, visible: false, low: false, closePanel: false },
    { name: 'chat on the stage', in: { hasConversation: true, minimized: false, stageVisible: true }, visible: false, low: false, closePanel: true },
    { name: 'scrolled past the stage', in: { hasConversation: true, minimized: false, stageVisible: false }, visible: true, low: false, closePanel: false },
    { name: 'minimized, hero on screen', in: { hasConversation: true, minimized: true, stageVisible: true }, visible: true, low: true, closePanel: false },
    { name: 'minimized and scrolled down', in: { hasConversation: true, minimized: true, stageVisible: false }, visible: true, low: true, closePanel: false },
  ]
  for (const c of cases) {
    assert.deepEqual(bubble(c.in), { visible: c.visible, low: c.low, closePanel: c.closePanel }, c.name)
  }
})

test('c5: "Minimizar" survives a reload in the same tab; blocked storage only forgets it', () => {
  const memory = new Map()
  const storage = { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) }
  const store = minimizedStore(() => storage)
  assert.equal(store.read(), false, 'fresh tab')
  store.write(true)
  assert.equal(minimizedStore(() => storage).read(), true, 'after a reload')
  assert.deepEqual([...memory], [['lab019:home:minimized', '1']])
  store.write(false)
  assert.equal(store.read(), false, 'back on the stage')
  assert.equal(memory.size, 0)

  const throwing = () => {
    throw new Error('SecurityError')
  }
  for (const [name, getter] of [
    ['reading sessionStorage throws', throwing],
    ['its methods throw', () => ({ getItem: throwing, setItem: throwing, removeItem: throwing })],
  ]) {
    const blocked = minimizedStore(getter)
    assert.doesNotThrow(() => blocked.write(true), name)
    assert.equal(blocked.read(), false, name)
  }
})
