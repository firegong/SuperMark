import { escapeHtml } from '../utils';
import { transformBytes } from './compression';
import { diagramError, diagramPlaceholder, markDiagramFailed, markDiagramRendered, type DiagramPlugin } from './registry';

/**
 * Offline renderer for draw.io / diagrams.net diagrams.
 *
 * Accepts the XML of a diagram (`<mxfile>`, `<diagram>` or `<mxGraphModel>`), as saved by
 * draw.io with "Compressed" on or off, and draws vertices (rectangles, rounded rectangles,
 * ellipses, rhombuses, text), edges (straight or with waypoints, arrows, labels) and groups as
 * SVG. Advanced shapes and stencils are drawn as rectangles with their label.
 */

interface Point { x: number; y: number }
interface Box { x: number; y: number; width: number; height: number }

interface Cell {
  id: string;
  parent: string | null;
  value: string;
  style: Map<string, string>;
  shape: string;
  vertex: boolean;
  edge: boolean;
  source: string | null;
  target: string | null;
  geometry: Box | null;
  points: Point[];
  sourcePoint: Point | null;
  targetPoint: Point | null;
}

let diagramCounter = 0;
const colorPattern = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|none)$/i;

function safeColor(value: string | undefined, fallback: string): string {
  return value !== undefined && colorPattern.test(value) ? value : fallback;
}

function parseStyle(style: string): { shape: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  let shape = '';
  for (const part of style.split(';')) {
    if (part.length === 0) {
      continue;
    }
    const eq = part.indexOf('=');
    if (eq === -1) {
      // A bare token names the shape/style, e.g. "ellipse;", "rhombus;", "text;".
      if (shape.length === 0) {
        shape = part.trim();
      }
    } else {
      map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }
  return { shape: map.get('shape') ?? shape, map };
}

function numberAttr(element: Element, name: string, fallback = 0): number {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : fallback;
}

function pointFrom(element: Element | null | undefined): Point | null {
  return element === null || element === undefined ? null : { x: numberAttr(element, 'x'), y: numberAttr(element, 'y') };
}

/** Plain text of a cell label (labels with `html=1` contain markup). */
function labelText(value: string, html: boolean): string {
  if (!html) {
    return value;
  }
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

function parseCells(model: Element): Cell[] {
  return Array.from(model.getElementsByTagName('mxCell')).map(element => {
    // Wrapped cells (<object label="…"><mxCell/></object>) keep the label on the wrapper.
    const wrapper = element.parentElement?.tagName === 'object' || element.parentElement?.tagName === 'UserObject'
      ? element.parentElement
      : null;
    const geometryElement = Array.from(element.children).find(child => child.tagName === 'mxGeometry');
    const { shape, map } = parseStyle(element.getAttribute('style') ?? '');
    const pointElements = geometryElement === undefined
      ? []
      : Array.from(geometryElement.getElementsByTagName('Array'))
        .filter(array => array.getAttribute('as') === 'points')
        .flatMap(array => Array.from(array.getElementsByTagName('mxPoint')));
    const findPoint = (as: string) => geometryElement === undefined
      ? null
      : pointFrom(Array.from(geometryElement.children).find(child => child.tagName === 'mxPoint' && child.getAttribute('as') === as));

    return {
      id: wrapper?.getAttribute('id') ?? element.getAttribute('id') ?? '',
      parent: element.getAttribute('parent'),
      value: wrapper?.getAttribute('label') ?? element.getAttribute('value') ?? '',
      style: map,
      shape,
      vertex: element.getAttribute('vertex') === '1',
      edge: element.getAttribute('edge') === '1',
      source: element.getAttribute('source'),
      target: element.getAttribute('target'),
      geometry: geometryElement === undefined ? null : {
        x: numberAttr(geometryElement, 'x'),
        y: numberAttr(geometryElement, 'y'),
        width: numberAttr(geometryElement, 'width'),
        height: numberAttr(geometryElement, 'height'),
      },
      points: pointElements.map(point => ({ x: numberAttr(point, 'x'), y: numberAttr(point, 'y') })),
      sourcePoint: findPoint('sourcePoint'),
      targetPoint: findPoint('targetPoint'),
    };
  });
}

/** Absolute box of a vertex, adding the offsets of parent groups/containers. */
function absoluteBox(cell: Cell, cells: Map<string, Cell>): Box | null {
  if (cell.geometry === null) {
    return null;
  }

  let { x, y } = cell.geometry;
  let parent = cell.parent === null ? undefined : cells.get(cell.parent);
  let guard = 0;
  while (parent !== undefined && parent.vertex && parent.geometry !== null && guard < 50) {
    x += parent.geometry.x;
    y += parent.geometry.y;
    parent = parent.parent === null ? undefined : cells.get(parent.parent);
    guard += 1;
  }

  return { x, y, width: cell.geometry.width, height: cell.geometry.height };
}

function center(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Point where the segment from the box centre towards `toward` leaves the box outline. */
function clipToBox(box: Box, toward: Point, shape: string): Point {
  const c = center(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) {
    return c;
  }

  const hw = box.width / 2;
  const hh = box.height / 2;
  let scale: number;
  if (shape === 'ellipse') {
    scale = 1 / Math.sqrt((dx * dx) / (hw * hw || 1) + (dy * dy) / (hh * hh || 1));
  } else if (shape === 'rhombus') {
    scale = 1 / (Math.abs(dx) / (hw || 1) + Math.abs(dy) / (hh || 1));
  } else {
    scale = Math.min(hw / (Math.abs(dx) || Number.EPSILON), hh / (Math.abs(dy) || Number.EPSILON));
  }

  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

function textLines(text: string, x: number, y: number, style: Map<string, string>, anchor = 'middle'): string {
  if (text.length === 0) {
    return '';
  }
  const lines = text.split('\n');
  const fontSize = Math.max(6, Math.min(72, Number(style.get('fontSize') ?? 12) || 12));
  // draw.io's default text colour; diagrams are drawn on a white canvas like in draw.io.
  const color = safeColor(style.get('fontColor'), '#1a1a1a');
  const weight = (Number(style.get('fontStyle') ?? 0) & 1) === 1 ? ' font-weight="bold"' : '';
  const italic = (Number(style.get('fontStyle') ?? 0) & 2) === 2 ? ' font-style="italic"' : '';
  const startY = y - ((lines.length - 1) * fontSize * 1.2) / 2;
  const spans = lines.map((line, index) => `<tspan x="${x}" y="${(startY + index * fontSize * 1.2).toFixed(1)}">${escapeHtml(line)}</tspan>`).join('');
  return `<text text-anchor="${anchor}" dominant-baseline="central" font-size="${fontSize}" fill="${color}"${weight}${italic}>${spans}</text>`;
}

function renderVertex(cell: Cell, box: Box): string {
  const style = cell.style;
  const fill = safeColor(style.get('fillColor'), cell.shape === 'text' ? 'none' : '#ffffff');
  const stroke = safeColor(style.get('strokeColor'), cell.shape === 'text' ? 'none' : '#333333');
  const strokeWidth = Math.max(0, Math.min(10, Number(style.get('strokeWidth') ?? 1) || 1));
  const dashed = style.get('dashed') === '1' ? ' stroke-dasharray="6 4"' : '';
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashed}`;
  const { x, y, width, height } = box;
  let shape: string;

  switch (cell.shape) {
    case 'ellipse':
    case 'doubleEllipse':
      shape = `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" ${paint}/>`;
      break;
    case 'rhombus':
      shape = `<polygon points="${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}" ${paint}/>`;
      break;
    case 'triangle':
      shape = `<polygon points="${x},${y} ${x + width},${y + height / 2} ${x},${y + height}" ${paint}/>`;
      break;
    case 'text':
    case 'edgeLabel':
      shape = '';
      break;
    default: {
      const rounded = style.get('rounded') === '1' ? Math.min(width, height) * 0.15 : 0;
      shape = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rounded}" ${paint}/>`;
    }
  }

  const isContainer = style.get('container') === '1' || cell.shape === 'swimlane';
  const labelY = isContainer ? y + 14 : y + height / 2;
  const text = textLines(labelText(cell.value, style.get('html') === '1'), x + width / 2, labelY, style);
  return `<g class="drawio-vertex">${shape}${text}</g>`;
}

function renderEdge(cell: Cell, cells: Map<string, Cell>, boxes: Map<string, Box>, markerFor: (color: string, start: boolean) => string): { svg: string; points: Point[] } | null {
  const sourceBox = cell.source === null ? undefined : boxes.get(cell.source);
  const targetBox = cell.target === null ? undefined : boxes.get(cell.target);
  const waypoints = cell.points;

  const startTarget = waypoints.at(0) ?? (targetBox === undefined ? cell.targetPoint : center(targetBox));
  const endSource = waypoints.at(-1) ?? (sourceBox === undefined ? cell.sourcePoint : center(sourceBox));
  const sourceShape = cell.source === null ? '' : cells.get(cell.source)?.shape ?? '';
  const targetShape = cell.target === null ? '' : cells.get(cell.target)?.shape ?? '';

  const start = sourceBox !== undefined && startTarget !== null ? clipToBox(sourceBox, startTarget, sourceShape) : cell.sourcePoint;
  const end = targetBox !== undefined && endSource !== null ? clipToBox(targetBox, endSource, targetShape) : cell.targetPoint;
  if (start === null || end === null) {
    return null;
  }

  const points = [start, ...waypoints, end];
  const style = cell.style;
  const stroke = safeColor(style.get('strokeColor'), '#333333');
  const strokeWidth = Math.max(0.5, Math.min(10, Number(style.get('strokeWidth') ?? 1) || 1));
  const dashed = style.get('dashed') === '1' ? ' stroke-dasharray="6 4"' : '';
  const endArrow = style.get('endArrow') !== 'none';
  const startArrow = style.get('startArrow') !== undefined && style.get('startArrow') !== 'none';
  const markers = `${endArrow ? ` marker-end="url(#${markerFor(stroke, false)})"` : ''}${startArrow ? ` marker-start="url(#${markerFor(stroke, true)})"` : ''}`;
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');

  let label = '';
  const text = labelText(cell.value, style.get('html') === '1');
  if (text.length > 0) {
    const mid = points[Math.floor((points.length - 1) / 2)];
    const next = points[Math.floor((points.length - 1) / 2) + 1];
    const lx = (mid.x + next.x) / 2;
    const ly = (mid.y + next.y) / 2;
    // Approximate text width: CJK/Hangul glyphs are about twice as wide as Latin ones.
    const longest = Math.max(...text.split('\n').map(line => Array.from(line).reduce((sum, char) => sum + (char.charCodeAt(0) >= 0x1100 ? 12 : 7), 0)));
    const lineCount = text.split('\n').length;
    label = `<rect x="${lx - longest / 2 - 2}" y="${ly - 9 * lineCount}" width="${longest + 4}" height="${18 * lineCount}" fill="var(--drawio-label-bg, #ffffff)"/>${textLines(text, lx, ly, style)}`;
  }

  return { svg: `<g class="drawio-edge" color="${stroke}"><path d="${path}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dashed}${markers}/>${label}</g>`, points };
}

/** Finds the `<mxGraphModel>` in already-decompressed XML. */
function findModel(xml: string): Element | null {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    return null;
  }
  return (document.getElementsByTagName('mxGraphModel')[0] as Element | undefined) ?? null;
}

/** Returns the compressed payload of the first `<diagram>` when it has no inline model. */
export function compressedDiagramPayload(xml: string): string | null {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    return null;
  }
  const diagram = document.getElementsByTagName('diagram')[0] as Element | undefined;
  if (diagram === undefined || diagram.getElementsByTagName('mxGraphModel').length > 0) {
    return null;
  }
  const payload = diagram.textContent.trim();
  return payload.length > 0 ? payload : null;
}

/** Inflates a compressed draw.io payload: base64 → raw deflate → URI-encoded XML. */
export async function inflateDrawioPayload(payload: string): Promise<string> {
  const binary = atob(payload);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const inflated = await transformBytes(bytes, new DecompressionStream('deflate-raw'));
  return decodeURIComponent(new TextDecoder().decode(inflated));
}

/** Renders draw.io XML (uncompressed) to SVG, or returns `null` when no model is found. */
export function renderDrawioToSvg(xml: string): string | null {
  const model = findModel(xml);
  if (model === null) {
    return null;
  }

  const cellList = parseCells(model);
  const cells = new Map(cellList.map(cell => [cell.id, cell]));
  const boxes = new Map<string, Box>();
  for (const cell of cellList) {
    if (cell.vertex) {
      const box = absoluteBox(cell, cells);
      if (box !== null) {
        boxes.set(cell.id, box);
      }
    }
  }

  const vertices = cellList.filter(cell => cell.vertex && boxes.has(cell.id)).map(cell => renderVertex(cell, boxes.get(cell.id) as Box));
  // One arrow marker per colour and direction; ids are unique per diagram so several diagrams
  // in one preview do not reuse each other's markers.
  diagramCounter += 1;
  const markers = new Map<string, string>();
  const markerFor = (color: string, start: boolean) => {
    const key = `${color}|${start ? 's' : 'e'}`;
    let id = markers.get(key);
    if (id === undefined) {
      id = `drawio-${diagramCounter}-arrow-${markers.size}`;
      markers.set(key, id);
    }
    return id;
  };
  const edges = cellList.filter(cell => cell.edge).map(cell => renderEdge(cell, cells, boxes, markerFor)).filter(edge => edge !== null);

  const allPoints: Point[] = [
    ...Array.from(boxes.values()).flatMap(box => [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height }]),
    ...edges.flatMap(edge => edge.points),
  ];
  if (allPoints.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="markedit-drawio" width="0" height="0"></svg>';
  }

  const margin = 10;
  const minX = Math.min(...allPoints.map(point => point.x)) - margin;
  const minY = Math.min(...allPoints.map(point => point.y)) - margin;
  const width = Math.max(...allPoints.map(point => point.x)) - minX + margin;
  const height = Math.max(...allPoints.map(point => point.y)) - minY + margin;
  const defs = `<defs>${Array.from(markers.entries()).map(([key, id]) => {
    const [color, direction] = key.split('|');
    return `<marker id="${id}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="${direction === 's' ? 'auto-start-reverse' : 'auto'}"><path d="M0 0 L10 5 L0 10 z" fill="${color}"/></marker>`;
  }).join('')}</defs>`;

  // Edges first so vertices (and their labels) are drawn on top of line ends.
  return `<svg xmlns="http://www.w3.org/2000/svg" class="markedit-drawio" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}" width="${width.toFixed(0)}" height="${height.toFixed(0)}" font-family="Helvetica, Arial, sans-serif">${defs}${edges.map(edge => edge.svg).join('')}${vertices.join('')}</svg>`;
}

export const drawioPlugin: DiagramPlugin = {
  id: 'drawio',
  name: 'draw.io',
  languages: ['drawio', 'diagramsnet', 'mxgraph'],
  render(code, lang) {
    const svg = renderDrawioToSvg(code);
    if (svg !== null) {
      return `<div class="markedit-diagram is-rendered"><div class="markedit-diagram-output">${svg}</div></div>`;
    }

    if (compressedDiagramPayload(code) !== null) {
      return diagramPlaceholder('drawio', lang, code, 'Decompressing draw.io diagram…');
    }

    return diagramError('draw.io: no <mxGraphModel> or <diagram> found. Paste the diagram XML (File → Export as → XML).', code);
  },
  async hydrate(element, code) {
    const payload = compressedDiagramPayload(code);
    if (payload === null) {
      markDiagramFailed(element, 'draw.io: the diagram could not be read.');
      return;
    }

    const svg = renderDrawioToSvg(await inflateDrawioPayload(payload));
    if (svg === null) {
      markDiagramFailed(element, 'draw.io: the compressed diagram does not contain a model.');
      return;
    }
    markDiagramRendered(element, svg);
  },
};
