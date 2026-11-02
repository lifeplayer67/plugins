/* eslint-disable */
// -----------------------------------------------------------------------------
// Canvas View — core: pure helpers and markdown rendering. No DOM, no state —
// everything here is unit-testable under Jest. Loaded in the window BEFORE
// canvasClient.js (which consumes it via window.CanvasViewCore).
// -----------------------------------------------------------------------------
;(function (root) {
  'use strict'

  // ---------- pure helpers (shared with tests) ----------

  var PRESET_COLORS = { 1: '#e93147', 2: '#ec7500', 3: '#e0ac00', 4: '#08b94e', 5: '#00bfbc', 6: '#7852ee' }

  function resolveColor(c, fallback) {
    // SECURITY: colors land inside style/SVG attributes — only presets or #hex pass
    if (!c) return fallback || '#8a8a8a'
    if (PRESET_COLORS[c]) return PRESET_COLORS[c]
    return /^#[0-9a-fA-F]{3,8}$/.test(String(c)) ? String(c) : fallback || '#8a8a8a'
  }

  /** SECURITY: geometry lands inside style/SVG attributes — coerce to finite numbers */
  function sanitizeCanvas(c) {
    function num(v, d) {
      v = Number(v)
      return isFinite(v) ? v : d
    }
    ;(c.nodes || []).forEach(function (n) {
      n.x = num(n.x, 0)
      n.y = num(n.y, 0)
      n.width = Math.max(10, num(n.width, 250))
      n.height = Math.max(10, num(n.height, 60))
    })
    return c
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  // Markdown is rendered by showdown — the same library and options NotePlan's own
  // helpers use for note HTML — so cards match the app instead of a hand-rolled subset.
  // In the window it's loaded via <script src="./showdown.min.js">; under Jest we
  // require() it from the repo.
  var showdownLib = typeof showdown !== 'undefined' ? showdown : typeof module !== 'undefined' && typeof require === 'function' ? require('showdown') : null
  var mdConverter = null

  function getConverter() {
    if (!mdConverter) {
      mdConverter = new showdownLib.Converter({
        emoji: true,
        footnotes: true,
        ghCodeBlocks: true,
        strikethrough: true,
        tables: true,
        tasklists: true,
        metadata: false,
        requireSpaceBeforeHeadingText: true,
        simpleLineBreaks: true,
        simplifiedAutoLink: true,
      })
    }
    return mdConverter
  }

  function renderMarkdown(md, assetBase) {
    // block raw HTML injection, keep markdown punctuation intact
    var safe = String(md).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    // Obsidian image embeds -> plain md images before conversion
    safe = safe.replace(/!\[\[([^\]]+)\]\]/g, '![]($1)')
    var html = getConverter().makeHtml(safe)
    // theme CSS targets 'p b' / 'p emph', not strong/em
    html = html.replace(/<(\/?)strong>/g, '<$1b>').replace(/<(\/?)em>/g, '<$1emph>')
    // wikilinks -> clickable note links (showdown leaves them as literal text)
    html = html.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, function (_, target, __, alias) {
      var title = String(target).split('/').pop().replace(/\.md$/, '')
      return '<a href="#" class="note-link" data-note-title="' + escapeHtml(title) + '">' + (alias || title) + '</a>'
    })
    // external links open outside; relative image srcs resolve against the Notes folder
    html = html.replace(/<a href="http/g, '<a target="_blank" href="http')
    html = html.replace(/<img src="(?!https?:|data:)([^"]+)"/g, function (_, src) {
      var encoded = /%[0-9A-Fa-f]{2}/.test(src) ? src : encodeURI(src)
      return '<img class="md-img" src="' + (assetBase || '../../Notes/') + encoded + '"'
    })
    return html
  }

  function genId() {
    var s = ''
    for (var i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16)
    return s
  }

  function anchorPoint(n, side) {
    if (side === 'top') return { x: n.x + n.width / 2, y: n.y }
    if (side === 'bottom') return { x: n.x + n.width / 2, y: n.y + n.height }
    if (side === 'left') return { x: n.x, y: n.y + n.height / 2 }
    return { x: n.x + n.width, y: n.y + n.height / 2 }
  }

  function sideNormal(side) {
    if (side === 'top') return { x: 0, y: -1 }
    if (side === 'bottom') return { x: 0, y: 1 }
    if (side === 'left') return { x: -1, y: 0 }
    return { x: 1, y: 0 }
  }

  function autoSides(from, to) {
    var dx = to.x + to.width / 2 - (from.x + from.width / 2)
    var dy = to.y + to.height / 2 - (from.y + from.height / 2)
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ['right', 'left'] : ['left', 'right']
    return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']
  }

  function nearestSide(node, wx, wy) {
    var best = 'right', bestD = Infinity
    ;['top', 'right', 'bottom', 'left'].forEach(function (side) {
      var p = anchorPoint(node, side)
      var d = Math.hypot(p.x - wx, p.y - wy)
      if (d < bestD) { bestD = d; best = side }
    })
    return best
  }

  function nodeInsideGroup(n, g) {
    return n.id !== g.id && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height
  }

  /** Groups activate only by their frame: is the point within `margin` of the border? */
  function isGroupBorderHit(g, wx, wy, margin) {
    var interior = wx > g.x + margin && wx < g.x + g.width - margin && wy > g.y + margin && wy < g.y + g.height - margin
    return !interior
  }

  /** Filter the note index for the autocomplete picker: title-prefix > title > path matches */
  function filterNotes(index, q) {
    var query = String(q || '').toLowerCase().trim()
    if (query === '') return index.slice(0, 8)
    var starts = [], titleHas = [], pathHas = []
    index.forEach(function (n) {
      var t = n.t.toLowerCase(), f = n.f.toLowerCase()
      if (t.indexOf(query) === 0) starts.push(n)
      else if (t.indexOf(query) >= 0) titleHas.push(n)
      else if (f.indexOf(query) >= 0) pathHas.push(n)
    })
    return starts.concat(titleHas, pathHas).slice(0, 8)
  }

  var pure = {
    resolveColor: resolveColor,
    anchorPoint: anchorPoint,
    sideNormal: sideNormal,
    escapeHtml: escapeHtml,
    renderMarkdown: renderMarkdown,
    autoSides: autoSides,
    nearestSide: nearestSide,
    nodeInsideGroup: nodeInsideGroup,
    isGroupBorderHit: isGroupBorderHit,
    sanitizeCanvas: sanitizeCanvas,
    genId: genId,
    filterNotes: filterNotes,
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = pure
  else root.CanvasViewCore = pure
})(this)
