/* global describe, test, expect, beforeAll */
/**
 * Interaction tests for the canvas gesture state machine, run against the REAL
 * client booted in jsdom (window.__CANVAS_TEST__ makes canvasClient.js run its
 * browser section and expose window.__canvasTestAPI).
 *
 * The client is booted ONCE per file (its listeners live on window/document),
 * so tests run as a sequence; each one cleans up after itself.
 */

const FIXTURE = {
  nodes: [
    { id: 'a', type: 'text', text: 'alpha', x: 0, y: 0, width: 200, height: 100 },
    { id: 'b', type: 'text', text: 'beta', x: 400, y: 0, width: 200, height: 100 },
    { id: 'g', type: 'group', label: 'G', x: -50, y: 250, width: 600, height: 400 },
    { id: 'c', type: 'text', text: 'inside group', x: 0, y: 300, width: 200, height: 100 },
  ],
  edges: [{ id: 'e-ab', fromNode: 'a', toNode: 'b' }],
}

let api

function mouse(type, target, opts = {}) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, detail: opts.detail ?? 1, ...opts })
  target.dispatchEvent(ev)
}

function elOf(id) {
  const el = document.querySelector(`.node[data-id="${id}"]`)
  if (!el) throw new Error(`no element for node ${id}`)
  return el
}

/** world -> screen using the live transform, so tests don't assume fit() details */
function screen(wx, wy) {
  const t = api.getTransform()
  return { clientX: wx * t.scale + t.tx, clientY: wy * t.scale + t.ty }
}

function clickNode(id, opts = {}) {
  mouse('mousedown', elOf(id), opts)
  mouse('mouseup', window, opts)
}

function pressKey(key, opts = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }))
}

function clearSelection() {
  pressKey('Escape')
}

beforeAll(() => {
  document.body.innerHTML = `
    <div id="viewport">
      <div id="world"></div>
      <div id="toolbar"></div>
      <div id="palette"><button data-new="text">+ card</button></div>
      <div id="hud"><span id="title"></span><span id="zoom-level"></span></div>
    </div>`
  const viewport = document.getElementById('viewport')
  Object.defineProperty(viewport, 'clientWidth', { value: 1000 })
  Object.defineProperty(viewport, 'clientHeight', { value: 800 })
  // jsdom's getBoundingClientRect returns zeros; derive it from inline styles
  // (enough for the marquee rectangle, which sets left/top/width/height in px)
  // $FlowIgnore[cannot-write]
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const s = this.style
    const left = parseFloat(s.left) || 0
    const top = parseFloat(s.top) || 0
    const width = parseFloat(s.width) || 0
    const height = parseFloat(s.height) || 0
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }
  }
  window.__CANVAS_TEST__ = true
  window.__canvas = JSON.parse(JSON.stringify(FIXTURE))
  window.__canvasPath = '../../../Notes/Canvases/test.canvas'
  require('../requiredFiles/canvasClient.js')
  api = window.__canvasTestAPI
})

describe('selection', () => {
  test('click selects a card; Escape clears', () => {
    clickNode('a')
    expect([...api.selectedNodes]).toEqual(['a'])
    clearSelection()
    expect(api.selectedNodes.size).toBe(0)
  })

  test('shift+click adds to the selection', () => {
    clickNode('a')
    clickNode('b', { shiftKey: true })
    expect(new Set(api.selectedNodes)).toEqual(new Set(['a', 'b']))
    clearSelection()
  })

  test('starting a background action drops the old selection immediately', () => {
    clickNode('a')
    mouse('mousedown', document.getElementById('viewport'), screen(900, -200))
    expect(api.selectedNodes.size).toBe(0)
    mouse('mouseup', window)
  })
})

describe('drag', () => {
  test('dragging a card moves it by the pointer delta divided by scale', () => {
    const t = api.getTransform()
    const before = api.getCanvas().nodes.find((n) => n.id === 'a')
    const { x: x0, y: y0 } = before
    mouse('mousedown', elOf('a'), { clientX: 100, clientY: 50 })
    mouse('mousemove', window, { clientX: 160, clientY: 90 })
    mouse('mouseup', window, { clientX: 160, clientY: 90 })
    const after = api.getCanvas().nodes.find((n) => n.id === 'a')
    expect(after.x).toBe(Math.round(x0 + 60 / t.scale))
    expect(after.y).toBe(Math.round(y0 + 40 / t.scale))
    // put it back for later tests
    after.x = x0
    after.y = y0
    clearSelection()
  })
})

describe('delete / undo / redo', () => {
  test('Backspace deletes the selected card and its edges; ⌘Z restores, ⇧⌘Z redoes', () => {
    clickNode('a')
    pressKey('Backspace')
    expect(api.getCanvas().nodes.find((n) => n.id === 'a')).toBeUndefined()
    expect(api.getCanvas().edges.find((e) => e.id === 'e-ab')).toBeUndefined()
    pressKey('z', { metaKey: true })
    expect(api.getCanvas().nodes.find((n) => n.id === 'a')).toBeDefined()
    expect(api.getCanvas().edges.find((e) => e.id === 'e-ab')).toBeDefined()
    pressKey('z', { metaKey: true, shiftKey: true })
    expect(api.getCanvas().nodes.find((n) => n.id === 'a')).toBeUndefined()
    pressKey('z', { metaKey: true }) // undo back to the full fixture
    clearSelection()
  })
})

describe('groups', () => {
  test('click on an unselected group interior does NOT select it', () => {
    mouse('mousedown', elOf('g'), screen(250, 500)) // deep interior
    mouse('mouseup', window)
    expect(api.selectedNodes.has('g')).toBe(false)
  })

  test('click on the group frame selects it; then interior drag moves it', () => {
    mouse('mousedown', elOf('g'), screen(-48, 450)) // on the left frame
    mouse('mouseup', window)
    expect(api.selectedNodes.has('g')).toBe(true)

    const t = api.getTransform()
    const g0 = { ...api.getCanvas().nodes.find((n) => n.id === 'g') }
    const c0 = { ...api.getCanvas().nodes.find((n) => n.id === 'c') }
    const p = screen(250, 500)
    mouse('mousedown', elOf('g'), p)
    mouse('mousemove', window, { clientX: p.clientX + 30, clientY: p.clientY })
    mouse('mouseup', window, { clientX: p.clientX + 30, clientY: p.clientY })
    const g1 = api.getCanvas().nodes.find((n) => n.id === 'g')
    const c1 = api.getCanvas().nodes.find((n) => n.id === 'c')
    expect(g1.x).toBe(Math.round(g0.x + 30 / t.scale))
    expect(c1.x).toBe(Math.round(c0.x + 30 / t.scale)) // contained card moved along
    pressKey('z', { metaKey: true })
    clearSelection()
  })

  test('rubber band selects intersecting cards but takes a group only when fully enclosed', () => {
    const vp = document.getElementById('viewport')
    const p1 = screen(-20, -20)
    const p2 = screen(650, 150)
    mouse('mousedown', vp, p1)
    mouse('mousemove', window, p2)
    mouse('mouseup', window, p2)
    expect(new Set(api.selectedNodes)).toEqual(new Set(['a', 'b'])) // g intersects but isn't enclosed
    clearSelection()

    const q1 = screen(-100, 200)
    const q2 = screen(700, 700)
    mouse('mousedown', vp, q1)
    mouse('mousemove', window, q2)
    mouse('mouseup', window, q2)
    expect(api.selectedNodes.has('g')).toBe(true) // fully enclosed now
    expect(api.selectedNodes.has('c')).toBe(true)
    clearSelection()
  })

  test('⌘G wraps the selection in a new group', () => {
    const before = api.getCanvas().nodes.length
    clickNode('a')
    clickNode('b', { shiftKey: true })
    pressKey('g', { metaKey: true })
    const nodes = api.getCanvas().nodes
    expect(nodes.length).toBe(before + 1)
    const group = nodes[nodes.length - 1]
    expect(group.type).toBe('group')
    expect(group.x).toBeLessThanOrEqual(0)
    expect(group.x + group.width).toBeGreaterThanOrEqual(600)
    // cleanup: remove the created group (it is the selection after ⌘G)
    document.querySelector('.node .label-input')?.remove()
    pressKey('Backspace')
    expect(api.getCanvas().nodes.length).toBe(before)
    clearSelection()
  })
})

describe('creation & editing', () => {
  test('double-click on the background creates a text card with an open editor', () => {
    const before = api.getCanvas().nodes.length
    mouse('mousedown', document.getElementById('viewport'), { ...screen(800, -300), detail: 2 })
    const nodes = api.getCanvas().nodes
    expect(nodes.length).toBe(before + 1)
    const created = nodes[nodes.length - 1]
    expect(created.type).toBe('text')
    const el = document.querySelector(`.node[data-id="${created.id}"]`)
    expect(el).not.toBeNull()
    expect(el.querySelector('textarea')).not.toBeNull()
    // cancel the editor, then delete the card
    el.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    clickNode(created.id)
    pressKey('Backspace')
    expect(api.getCanvas().nodes.length).toBe(before)
  })

  test('double-click on a text card opens its editor; Escape cancels without changes', () => {
    const before = api.getCanvas().nodes.find((n) => n.id === 'a').text
    mouse('mousedown', elOf('a'), { detail: 2 })
    const ta = elOf('a').querySelector('textarea')
    expect(ta).not.toBeNull()
    ta.value = 'changed'
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(api.getCanvas().nodes.find((n) => n.id === 'a').text).toBe(before)
    clearSelection()
  })
})
