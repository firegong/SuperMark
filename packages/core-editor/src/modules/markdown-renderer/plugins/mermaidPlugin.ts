import { escapeHtml } from '../utils';
import { monospaceStack } from '../../../styling/fonts';

interface MermaidNode {
  id: string;
  label: string;
  shape: 'rect' | 'round' | 'diamond' | 'circle';
}

interface MermaidEdge {
  from: string;
  to: string;
  type: 'solid' | 'dashed' | 'thick' | 'line';
  label: string;
}

function parseMermaidNode(definition: string): MermaidNode | null {
  const trimmed = definition.trim();
  const idMatch = /^([a-zA-Z0-9_]+)/.exec(trimmed);
  if (idMatch === null) {
    return null;
  }

  const id = idMatch[1];
  const rest = trimmed.slice(id.length);

  const rectMatch = /^\[([^\]]+)\]/.exec(rest);
  if (rectMatch !== null) {
    return { id, label: rectMatch[1].trim(), shape: 'rect' };
  }

  const roundMatch = /^\(([^)]+)\)/.exec(rest);
  if (roundMatch !== null) {
    return { id, label: roundMatch[1].trim(), shape: 'round' };
  }

  const diamondMatch = /^\{([^}]+)\}/.exec(rest);
  if (diamondMatch !== null) {
    return { id, label: diamondMatch[1].trim(), shape: 'diamond' };
  }

  const circleMatch = /^\(\(([^)]+)\)\)/.exec(rest);
  if (circleMatch !== null) {
    return { id, label: circleMatch[1].trim(), shape: 'circle' };
  }

  return { id, label: id, shape: 'rect' };
}

function parseMermaidEdge(line: string): { from: string; edgeStr: string; rest: string } | null {
  const operators = ['-.->', '==>', '-->', '---'];
  for (const operator of operators) {
    const index = line.indexOf(operator);
    if (index !== -1) {
      const from = line.slice(0, index).trim();
      const after = line.slice(index + operator.length).trim();
      return { from, edgeStr: operator, rest: after };
    }
  }
  return null;
}

function renderMermaidFlowchart(lines: string[]): string {
  const nodes = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];
  let direction: 'TD' | 'LR' | 'TB' | 'BT' | 'RL' = 'TD';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('%%')) {
      continue;
    }

    const dirMatch = /^(?:graph|flowchart)\s+(TD|LR|TB|BT|RL)/i.exec(line);
    if (dirMatch !== null) {
      direction = dirMatch[1].toUpperCase() as typeof direction;
      continue;
    }

    const statements = line.split(';').map(part => part.trim()).filter(part => part.length > 0);
    for (const statement of statements) {
      const edge = parseMermaidEdge(statement);
      if (edge !== null) {
        const fromNode = parseMermaidNode(edge.from);
        let label = '';
        let target = edge.rest;

        const labelMatch = /^\|([^|]+)\|\s*(.*)$/.exec(edge.rest);
        if (labelMatch !== null) {
          label = labelMatch[1].trim();
          target = labelMatch[2].trim();
        }

        const toNode = parseMermaidNode(target);
        if (fromNode !== null) {
          nodes.set(fromNode.id, fromNode);
        }
        if (toNode !== null) {
          nodes.set(toNode.id, toNode);
          edges.push({
            from: fromNode?.id ?? '',
            to: toNode.id,
            type: edge.edgeStr === '-.->' ? 'dashed' : edge.edgeStr === '==>' ? 'thick' : edge.edgeStr === '---' ? 'line' : 'solid',
            label,
          });
        }
        continue;
      }

      const node = parseMermaidNode(statement);
      if (node !== null) {
        nodes.set(node.id, node);
      }
    }
  }

  if (nodes.size === 0) {
    return '';
  }

  const nodeList = Array.from(nodes.values());
  const levels = new Map<string, number>();
  for (const node of nodeList) {
    levels.set(node.id, 0);
  }

  for (let iteration = 0; iteration < nodeList.length; iteration += 1) {
    for (const edge of edges) {
      const fromLevel = levels.get(edge.from) ?? 0;
      const toLevel = levels.get(edge.to) ?? 0;
      if (toLevel < fromLevel + 1) {
        levels.set(edge.to, fromLevel + 1);
      }
    }
  }

  const nodesByLevel = new Map<number, MermaidNode[]>();
  for (const node of nodeList) {
    const level = levels.get(node.id) ?? 0;
    if (!nodesByLevel.has(level)) {
      nodesByLevel.set(level, []);
    }
    nodesByLevel.get(level)?.push(node);
  }

  const levelArray = Array.from(nodesByLevel.entries()).sort((a, b) => a[0] - b[0]);
  const colSpacing = 180;
  const rowSpacing = 80;
  const margin = 40;

  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const [level, levelNodes] of levelArray) {
    for (let index = 0; index < levelNodes.length; index += 1) {
      const node = levelNodes[index];
      const labelWidth = Math.max(60, node.label.length * 7 + 24);
      const width = node.shape === 'circle' ? Math.max(labelWidth, 60) : labelWidth;
      const height = node.shape === 'circle' ? width : 44;
      const horizontalDirections = new Set(['LR', 'RL']);
      const reversedDirections = new Set(['BT', 'RL']);
      const isHorizontal = horizontalDirections.has(direction);
      const isReversed = reversedDirections.has(direction);

      const levelIndex = isReversed ? levelArray.length - 1 - level : level;
      const nodeIndex = index;

      const x = isHorizontal
        ? margin + nodeIndex * rowSpacing
        : margin + levelIndex * colSpacing;
      const y = isHorizontal
        ? margin + levelIndex * colSpacing
        : margin + nodeIndex * rowSpacing;

      positions.set(node.id, { x, y, w: width, h: height });
    }
  }

  let maxX = margin;
  let maxY = margin;
  for (const pos of positions.values()) {
    maxX = Math.max(maxX, pos.x + pos.w + margin);
    maxY = Math.max(maxY, pos.y + pos.h + margin);
  }

  const svgWidth = maxX;
  const svgHeight = maxY;
  let svg = `<svg class="markedit-mermaid-svg" xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">`;
  svg += '<defs><marker id="markedit-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="var(--chrome-text, #1f2328)"/></marker></defs>';

  const centerOf = (node: MermaidNode) => {
    const pos = positions.get(node.id) as { x: number; y: number; w: number; h: number };
    return { x: pos.x + pos.w / 2, y: pos.y + pos.h / 2 };
  };

  const boundaryPoint = (node: MermaidNode, targetX: number, targetY: number) => {
    const pos = positions.get(node.id) as { x: number; y: number; w: number; h: number };
    const cx = pos.x + pos.w / 2;
    const cy = pos.y + pos.h / 2;
    const dx = targetX - cx;
    const dy = targetY - cy;
    const angle = Math.atan2(dy, dx);

    if (node.shape === 'circle') {
      const radius = pos.w / 2;
      return {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      };
    }

    const halfW = pos.w / 2;
    const halfH = pos.h / 2;
    const tan = Math.tan(angle);
    let bx = halfW * Math.sign(Math.cos(angle));
    let by = bx * tan;
    if (Math.abs(by) > halfH) {
      by = halfH * Math.sign(Math.sin(angle));
      bx = by / tan;
    }

    return { x: cx + bx, y: cy + by };
  };

  for (const edge of edges) {
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    if (fromNode === undefined || toNode === undefined) {
      continue;
    }

    const target = centerOf(toNode);
    const start = boundaryPoint(fromNode, target.x, target.y);
    const end = boundaryPoint(toNode, start.x, start.y);

    const strokeDash = edge.type === 'dashed' ? ' stroke-dasharray="4,4"' : '';
    const strokeWidth = edge.type === 'thick' ? 3 : 1;
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    svg += `<path d="M${start.x},${start.y} L${end.x},${end.y}" stroke="var(--chrome-text, #1f2328)" stroke-width="${strokeWidth}" fill="none" marker-end="url(#markedit-arrow)"${strokeDash}/>`;

    if (edge.label.length > 0) {
      svg += `<rect x="${midX - edge.label.length * 3.5 - 4}" y="${midY - 10}" width="${edge.label.length * 7 + 8}" height="18" fill="var(--preview-bg, var(--chrome-bg-solid, #ffffff))" rx="3"/>`;
      svg += `<text x="${midX}" y="${midY + 4}" text-anchor="middle" font-size="11" fill="var(--chrome-text, #1f2328)">${escapeHtml(edge.label)}</text>`;
    }
  }

  for (const node of nodeList) {
    const pos = positions.get(node.id) as { x: number; y: number; w: number; h: number };
    const cx = pos.x + pos.w / 2;
    const cy = pos.y + pos.h / 2;
    const fill = 'var(--chrome-input-bg, rgba(255,255,255,0.65))';
    const stroke = 'var(--chrome-accent, #005fb8)';

    if (node.shape === 'rect') {
      svg += `<rect x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${pos.h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    } else if (node.shape === 'round') {
      svg += `<rect x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${pos.h}" rx="${pos.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    } else if (node.shape === 'circle') {
      svg += `<circle cx="${cx}" cy="${cy}" r="${pos.w / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    } else {
      const points = `${cx},${pos.y} ${pos.x + pos.w},${cy} ${cx},${pos.y + pos.h} ${pos.x},${cy}`;
      svg += `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    }

    svg += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12" fill="var(--chrome-text, #1f2328)">${escapeHtml(node.label)}</text>`;
  }

  svg += '</svg>';
  return svg;
}

interface SequenceParticipant {
  id: string;
  label: string;
}

interface SequenceMessage {
  from: string;
  to: string;
  text: string;
  dashed: boolean;
  open: boolean;
  lost: boolean;
}

function renderMermaidSequence(lines: string[]): string {
  const participants: SequenceParticipant[] = [];
  const messages: SequenceMessage[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('%%')) {
      continue;
    }

    const participantMatch = /^(?:participant|actor)\s+([a-zA-Z0-9_]+)(?:\s+as\s+(.+))?$/.exec(line);
    if (participantMatch !== null) {
      const optionalLabel = participantMatch[2] as string | undefined;
      const label = optionalLabel !== undefined ? optionalLabel.trim() : participantMatch[1].trim();
      participants.push({ id: participantMatch[1], label });
      continue;
    }

    const messageMatch = /^([a-zA-Z0-9_]+)\s*(-?-{0,1}>?>?x?)\s*([a-zA-Z0-9_]+)\s*:\s*(.+)$/.exec(line);
    if (messageMatch !== null) {
      const arrow = messageMatch[2];
      messages.push({
        from: messageMatch[1],
        to: messageMatch[3],
        text: messageMatch[4].trim(),
        dashed: arrow.includes('--'),
        open: arrow.includes('>>'),
        lost: arrow.includes('x'),
      });
      continue;
    }
  }

  const implicit = new Set<string>();
  for (const message of messages) {
    implicit.add(message.from);
    implicit.add(message.to);
  }
  for (const id of implicit) {
    if (!participants.some(p => p.id === id)) {
      participants.push({ id, label: id });
    }
  }

  if (participants.length === 0) {
    return '';
  }

  const participantWidth = 120;
  const marginX = 60;
  const marginY = 30;
  const laneGap = 160;
  const rowHeight = 60;
  const width = marginX * 2 + (participants.length - 1) * laneGap + participantWidth;
  const height = marginY * 2 + (messages.length + 1) * rowHeight;

  let svg = `<svg class="markedit-mermaid-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += '<defs><marker id="markedit-seq-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="var(--chrome-text, #1f2328)"/></marker></defs>';

  const laneX = (index: number) => marginX + index * laneGap + participantWidth / 2;
  const headerY = marginY + 20;

  for (let index = 0; index < participants.length; index += 1) {
    const x = laneX(index);
    const label = participants[index].label;
    svg += `<rect x="${x - participantWidth / 2}" y="${headerY - 18}" width="${participantWidth}" height="36" rx="4" fill="var(--chrome-input-bg)" stroke="var(--chrome-accent)" stroke-width="1.5"/>`;
    svg += `<text x="${x}" y="${headerY + 4}" text-anchor="middle" font-size="12" fill="var(--chrome-text)">${escapeHtml(label)}</text>`;
  }

  for (let index = 0; index < participants.length; index += 1) {
    const x = laneX(index);
    svg += `<line x1="${x}" y1="${headerY + 20}" x2="${x}" y2="${height - marginY}" stroke="var(--chrome-border)" stroke-width="1" stroke-dasharray="4,4"/>`;
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const fromIndex = participants.findIndex(p => p.id === message.from);
    const toIndex = participants.findIndex(p => p.id === message.to);
    if (fromIndex === -1 || toIndex === -1) {
      continue;
    }

    const y = headerY + 40 + index * rowHeight;
    const x1 = laneX(fromIndex);
    const x2 = laneX(toIndex);
    const strokeDash = message.dashed ? ' stroke-dasharray="4,4"' : '';
    const endX = message.lost ? (x1 + x2) / 2 : x2;

    svg += `<line x1="${x1}" y1="${y}" x2="${endX}" y2="${y}" stroke="var(--chrome-text)" stroke-width="1.5" marker-end="url(#markedit-seq-arrow)"${strokeDash}/>`;
    if (message.lost) {
      svg += `<text x="${endX}" y="${y + 14}" text-anchor="middle" font-size="14" fill="var(--chrome-text)">✕</text>`;
    }

    const midX = (x1 + x2) / 2;
    svg += `<text x="${midX}" y="${y - 6}" text-anchor="middle" font-size="11" fill="var(--chrome-text-secondary)">${escapeHtml(message.text)}</text>`;
  }

  svg += '</svg>';
  return svg;
}

export function renderMermaidToSvg(source: string): string {
  const lines = source.split('\n');
  const first = lines.find(line => line.trim().length > 0 && !line.trim().startsWith('%%')) ?? '';

  if (/^sequenceDiagram/i.test(first.trim())) {
    return renderMermaidSequence(lines);
  }

  const flowchartSvg = renderMermaidFlowchart(lines);
  if (flowchartSvg.length > 0) {
    return flowchartSvg;
  }

  const escaped = escapeHtml(source.trim());
  return `<div class="markedit-mermaid-svg" style="padding: 16px; white-space: pre-wrap; font-family: ${monospaceStack.replace(/'/g, '&quot;').replace(/"/g, '&quot;')};">${escaped}</div>`;
}
