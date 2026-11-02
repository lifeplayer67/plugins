// @flow
// -----------------------------------------------------------------------------
// Server-side shell for the canvas window. All rendering and interaction live
// in requiredFiles/canvasClient.js (loaded via <script src>); this module just
// embeds the canvas data safely and ships the CSS.
// Spec: https://jsoncanvas.org / https://github.com/obsidianmd/jsoncanvas
// -----------------------------------------------------------------------------

export type TCanvasData = {
  nodes?: Array<Object>,
  edges?: Array<Object>,
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Make a JSON blob safe to inline inside a <script> tag */
export function inlineJSON(value: any): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

const SWATCHES = ['1', '2', '3', '4', '5', '6']
  .map((c) => `<div class="swatch" data-color="${c}" title="Color ${c}"></div>`)
  .join('')

export function renderCanvasHTML(
  canvas: TCanvasData,
  title: string,
  canvasPath: string,
  fileContents: { [string]: Object } = {},
  noteIndex: Array<{ t: string, f: string }> = [],
): string {
  return `
<link rel="stylesheet" href="./canvasView.css">
<script>
window.__canvas = ${inlineJSON(canvas)}
window.__canvasPath = ${inlineJSON(canvasPath)}
window.__fileContents = ${inlineJSON(fileContents)}
window.__noteIndex = ${inlineJSON(noteIndex)}
</script>
<div id="viewport">
  <div id="world"></div>
  <div id="toolbar">${SWATCHES}<div class="swatch swatch-none" title="No color">×</div><div class="tb-group" title="Group the selection (⌘G)">⊞</div><div class="tb-delete" title="Delete (⌫)">🗑</div></div>
  <div id="palette">
    <button data-new="text" title="Drag onto the canvas or click (double-click the background works too)">+ card</button>
    <button data-new="file" title="Drag onto the canvas or click — with note autocomplete">+ note</button>
    <button data-new="group" title="Drag onto the canvas or click (⌘G groups the selection)">+ group</button>
  </div>
  <div id="hud"><span id="title">${escapeHtml(title)}</span><span id="zoom-level"></span></div>
</div>
<script type="text/javascript" src="./showdown.min.js"></script>
<script type="text/javascript" src="./canvasCore.js"></script>
<script type="text/javascript" src="./canvasClient.js"></script>
`
}
