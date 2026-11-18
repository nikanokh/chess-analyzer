import { Chess, Square } from 'chess.js';
import { MoveNode, PlayerColor } from '../../types/chess';

export const DEFAULT_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let idCounter = 1;
export function generateNodeId(): string {
  return `node_${Date.now()}_${idCounter++}`;
}

export function createRootNode(initialFen: string = DEFAULT_START_FEN): MoveNode {
  return {
    id: 'root',
    parentId: null,
    ply: 0,
    moveNumber: 0,
    color: 'b',
    san: '',
    uci: '',
    fen: initialFen,
    children: [],
    isMainline: true,
    userArrows: [],
    squareHighlights: [],
  };
}

/**
 * Returns the primary continuation child of `node`.
 * Uses `isMainline === true` as the authoritative mainline selector on mainline nodes,
 * and falls back to `children[0]` inside side-variation subtrees.
 */
export function getPrimaryChild(node: MoveNode): MoveNode | undefined {
  if (node.children.length === 0) return undefined;
  return node.children.find((c) => c.isMainline) || node.children[0];
}

/**
 * Enforces strict mainline invariants across the entire tree:
 * 1. `root.isMainline = true`.
 * 2. If a parent has `isMainline === true` and `children.length > 0`,
 *    exactly one child has `isMainline === true` (and is positioned at `children[0]`),
 *    while all other sibling children have `isMainline === false`.
 * 3. If a parent has `isMainline === false`, all of its descendants have `isMainline === false`.
 */
export function normalizeMainlineFlags(root: MoveNode, promoteChainFromNode?: MoveNode): void {
  root.isMainline = true;

  if (promoteChainFromNode) {
    let curr: MoveNode | undefined = promoteChainFromNode;
    while (curr) {
      curr.isMainline = true;
      curr = curr.children.find((c) => c.isMainline) || curr.children[0];
    }
  }

  function enforce(node: MoveNode) {
    if (!node.isMainline) {
      for (const child of node.children) {
        child.isMainline = false;
        enforce(child);
      }
      return;
    }

    if (node.children.length === 0) return;

    let mainIdx = node.children.findIndex((c) => c.isMainline);
    if (mainIdx === -1) {
      mainIdx = 0;
    }

    // Keep the authoritative mainline child at index 0 for consistent ordering
    if (mainIdx > 0) {
      const [mainChild] = node.children.splice(mainIdx, 1);
      node.children.unshift(mainChild);
    }

    node.children[0].isMainline = true;
    for (let i = 1; i < node.children.length; i++) {
      node.children[i].isMainline = false;
    }

    // If children[0] was just promoted to mainline, ensure its primary continuation chain is also mainline
    let chain = node.children[0];
    while (chain.children.length > 0 && !chain.children.some((c) => c.isMainline)) {
      chain.children[0].isMainline = true;
      chain = chain.children[0];
    }

    for (const child of node.children) {
      enforce(child);
    }
  }

  enforce(root);
}

export function findNodeById(root: MoveNode, id: string): MoveNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

export function getMainlineNodes(root: MoveNode): MoveNode[] {
  const result: MoveNode[] = [root];
  let current = root;
  while (current.children.length > 0) {
    const nextMain = getPrimaryChild(current)!;
    result.push(nextMain);
    current = nextMain;
  }
  return result;
}

export function getPathToNode(root: MoveNode, targetId: string): MoveNode[] {
  const path: MoveNode[] = [];
  function dfs(current: MoveNode): boolean {
    path.push(current);
    if (current.id === targetId) return true;
    for (const child of current.children) {
      if (dfs(child)) return true;
    }
    path.pop();
    return false;
  }
  dfs(root);
  return path;
}

/**
 * Adds a legal move from `parentNode` using chess.js as the single source of truth.
 * If the move already exists among `parentNode.children`, returns the existing child node.
 * Otherwise, appends a new MoveNode (as a variation if mainline already exists).
 */
export function addMoveToTree(
  root: MoveNode,
  parentNodeId: string,
  moveInput: { from: Square; to: Square; promotion?: string } | string
): { updatedRoot: MoveNode; newNode: MoveNode | null; error?: string } {
  const clonedRoot: MoveNode = structuredClone(root);
  const parentNode = findNodeById(clonedRoot, parentNodeId);
  if (!parentNode) {
    return { updatedRoot: root, newNode: null, error: 'Исходная позиция не найдена' };
  }

  const chess = new Chess(parentNode.fen);
  let moveResult;
  try {
    moveResult = chess.move(moveInput);
  } catch (err) {
    return {
      updatedRoot: root,
      newNode: null,
      error: err instanceof Error ? err.message : 'Недопустимый ход',
    };
  }

  if (!moveResult) {
    return { updatedRoot: root, newNode: null, error: 'Недопустимый ход по правилам шахмат' };
  }

  const uci = `${moveResult.from}${moveResult.to}${moveResult.promotion || ''}`;
  const existingChild = parentNode.children.find(
    (c) => c.uci === uci || c.san === moveResult.san
  );
  if (existingChild) {
    return { updatedRoot: clonedRoot, newNode: existingChild };
  }

  const nextPly = parentNode.ply + 1;
  const nextMoveNumber = Math.ceil(nextPly / 2);
  const hasMainlineSibling = parentNode.children.some((c) => c.isMainline);
  const isMainline = parentNode.isMainline && !hasMainlineSibling && parentNode.children.length === 0;

  const newNode: MoveNode = {
    id: generateNodeId(),
    parentId: parentNode.id,
    ply: nextPly,
    moveNumber: nextMoveNumber,
    color: moveResult.color as PlayerColor,
    san: moveResult.san,
    uci,
    from: moveResult.from as Square,
    to: moveResult.to as Square,
    fen: chess.fen(),
    children: [],
    isMainline,
    userArrows: [],
    squareHighlights: [],
  };

  parentNode.children.push(newNode);
  normalizeMainlineFlags(clonedRoot);
  return { updatedRoot: clonedRoot, newNode };
}

/**
 * Deletes a node and its subtree starting at `nodeId` (cannot delete root).
 * If the deleted node was `isMainline === true` and its parent still has remaining
 * variation children, automatically promotes the first remaining child (and its primary
 * continuation chain) to become the new mainline (`isMainline = true`).
 */
export function deleteVariationNode(root: MoveNode, nodeId: string): MoveNode {
  if (nodeId === 'root') return root;
  const clonedRoot: MoveNode = structuredClone(root);

  function removeChild(current: MoveNode): boolean {
    const idx = current.children.findIndex((c) => c.id === nodeId);
    if (idx !== -1) {
      const [removed] = current.children.splice(idx, 1);
      if (removed.isMainline && current.isMainline && current.children.length > 0) {
        // Promote the first remaining variation branch to mainline
        let promoted: MoveNode | undefined = current.children[0];
        while (promoted) {
          promoted.isMainline = true;
          promoted = promoted.children[0];
        }
      }
      return true;
    }
    for (const child of current.children) {
      if (removeChild(child)) return true;
    }
    return false;
  }

  removeChild(clonedRoot);
  normalizeMainlineFlags(clonedRoot);
  return clonedRoot;
}

/**
 * Converts UCI move string sequence (e.g. ["e2e4", "e7e5"]) from a given FEN into SAN strings.
 */
export function uciLineToSan(fen: string, uciMoves: string[], maxPlies = 8): string[] {
  const sanMoves: string[] = [];
  try {
    const chess = new Chess(fen);
    for (let i = 0; i < Math.min(uciMoves.length, maxPlies); i++) {
      const uci = uciMoves[i];
      if (!uci || uci.length < 4) break;
      const from = uci.slice(0, 2) as Square;
      const to = uci.slice(2, 4) as Square;
      const promotion = uci.length > 4 ? uci[4] : undefined;
      const move = chess.move({ from, to, promotion });
      if (!move) break;
      sanMoves.push(move.san);
    }
  } catch {
    // stop on invalid move in pv
  }
  return sanMoves;
}

/**
 * Exports the MoveNode tree (including nested variations and comments) to standard PGN format.
 * Uses `getPrimaryChild(node)` (which prioritizes `c.isMainline === true`) so the exported
 * mainline always matches `getMainlineNodes(root)`.
 */
export function exportTreeToPgn(
  root: MoveNode,
  headers: Record<string, string> = {}
): string {
  const headerLines = Object.entries(headers)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `[${k} "${v.replace(/"/g, '\\"')}"]`);

  function serializeSubtree(node: MoveNode, forceMoveNumber: boolean): string {
    if (node.children.length === 0) return '';
    const mainChild = getPrimaryChild(node)!;
    const variations = node.children.filter((c) => c.id !== mainChild.id);

    const prefix =
      mainChild.color === 'w'
        ? `${mainChild.moveNumber}. `
        : forceMoveNumber
          ? `${mainChild.moveNumber}... `
          : '';

    let text = `${prefix}${mainChild.san}`;
    if (mainChild.comment) {
      text += ` { ${mainChild.comment} }`;
    }

    for (const v of variations) {
      const vPrefix = v.color === 'w' ? `${v.moveNumber}. ` : `${v.moveNumber}... `;
      let vEntry = `${vPrefix}${v.san}`;
      if (v.comment) {
        vEntry += ` { ${v.comment} }`;
      }
      const vContinuation = serializeSubtree(v, false);
      text += ` (${vEntry}${vContinuation ? ' ' + vContinuation : ''})`;
    }

    const nextText = serializeSubtree(mainChild, variations.length > 0);
    if (nextText) {
      text += ` ${nextText}`;
    }
    return text;
  }

  const movesBody = serializeSubtree(root, true);
  const resultTag = headers.Result || '*';
  const bodyWithResult = `${movesBody ? movesBody + ' ' : ''}${resultTag}`.trim();
  if (headerLines.length === 0) {
    return bodyWithResult;
  }
  return `${headerLines.join('\n')}\n\n${bodyWithResult}`.trim();
}

/**
 * Parses PGN movetext (including nested `( ... )` variations and `{ ... }` comments)
 * into a complete `MoveNode` tree starting from `initialFen`.
 * Supports full round-trip export and re-import via `exportTreeToPgn`.
 */
export function parsePgnMovetextToTree(
  pgnText: string,
  initialFen: string = DEFAULT_START_FEN
): MoveNode {
  const root = createRootNode(initialFen);

  // Strip PGN header tags `[Key "Value"]` at the top of the PGN
  const body = pgnText.replace(/^\s*(?:\[[A-Za-z0-9_]+\s+"(?:\\"|[^"])*"\]\s*)*/g, '').trim();
  if (!body) return root;

  // Tokenize PGN body into parentheses, comments `{...}`, and move tokens
  const tokens: Array<{ type: 'lparen' | 'rparen' | 'comment' | 'word'; value: string }> = [];
  let i = 0;
  const n = body.length;

  while (i < n) {
    const ch = body[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '{') {
      const endIdx = body.indexOf('}', i + 1);
      if (endIdx === -1) {
        tokens.push({ type: 'comment', value: body.slice(i + 1).trim() });
        break;
      }
      tokens.push({ type: 'comment', value: body.slice(i + 1, endIdx).trim() });
      i = endIdx + 1;
      continue;
    }
    if (ch === ';') {
      const endLine = body.indexOf('\n', i + 1);
      i = endLine === -1 ? n : endLine + 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
      continue;
    }

    let j = i;
    while (j < n && !/[\s{}();]/.test(body[j])) {
      j++;
    }
    const word = body.slice(i, j);
    if (word) {
      tokens.push({ type: 'word', value: word });
    }
    i = j;
  }

  const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '½-½', '*']);
  let currentNode: MoveNode = root;
  let lastMoveParent: MoveNode = root;
  const branchStack: Array<{ currentNode: MoveNode; lastMoveParent: MoveNode }> = [];

  for (const tok of tokens) {
    if (tok.type === 'lparen') {
      branchStack.push({ currentNode, lastMoveParent });
      // A variation `( ... )` is an alternative to the last move played, so it branches from `lastMoveParent`
      currentNode = lastMoveParent;
      continue;
    }

    if (tok.type === 'rparen') {
      const popped = branchStack.pop();
      if (popped) {
        currentNode = popped.currentNode;
        lastMoveParent = popped.lastMoveParent;
      }
      continue;
    }

    if (tok.type === 'comment') {
      if (currentNode.id !== 'root') {
        currentNode.comment = currentNode.comment
          ? `${currentNode.comment} ${tok.value}`
          : tok.value;
      }
      continue;
    }

    // Word token: strip move numbers (e.g. "1.", "12...", "1.e4") and NAGs ("$1")
    const rawWord = tok.value;
    if (RESULT_TOKENS.has(rawWord) || rawWord.startsWith('$')) {
      continue;
    }

    const cleanedSan = rawWord
      .replace(/^\d+\.+/g, '')
      .replace(/[!?]+$/g, '')
      .trim();

    if (!cleanedSan || RESULT_TOKENS.has(cleanedSan)) {
      continue;
    }

    try {
      const chess = new Chess(currentNode.fen);
      const moveObj = chess.move(cleanedSan);
      if (!moveObj) continue;

      const uci = `${moveObj.from}${moveObj.to}${moveObj.promotion || ''}`;
      let childNode = currentNode.children.find(
        (c) => c.uci === uci || c.san === moveObj.san
      );

      if (!childNode) {
        const nextPly = currentNode.ply + 1;
        const nextMoveNumber = Math.ceil(nextPly / 2);
        const isOnMainline =
          branchStack.length === 0 &&
          currentNode.isMainline &&
          currentNode.children.length === 0;

        childNode = {
          id: generateNodeId(),
          parentId: currentNode.id,
          ply: nextPly,
          moveNumber: nextMoveNumber,
          color: moveObj.color as PlayerColor,
          san: moveObj.san,
          uci,
          from: moveObj.from as Square,
          to: moveObj.to as Square,
          fen: chess.fen(),
          children: [],
          isMainline: isOnMainline,
          userArrows: [],
          squareHighlights: [],
        };
        currentNode.children.push(childNode);
      }

      lastMoveParent = currentNode;
      currentNode = childNode;
    } catch {
      // ignore unparseable annotation token
    }
  }

  normalizeMainlineFlags(root);
  return root;
}
