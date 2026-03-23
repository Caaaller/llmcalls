import * as fs from 'fs';
import type { CallAction } from '../ivrNavigatorService';
import type {
  RecordedCall,
  RecordedCallTree,
  TreeNode,
  TreeEdge,
  TerminalOutcome,
} from './recordedCallTypes';
import { isTerminalOutcome } from './recordedCallTypes';
import { isSpeechMatch } from './fuzzyMatch';

function edgeMatchesAction(edge: TreeEdge, action: CallAction): boolean {
  if (edge.aiAction.action !== action.action) return false;
  if (action.action === 'press_digit')
    return edge.aiAction.digit === action.digit;
  return true;
}

function clearLatestPath(node: TreeNode): void {
  for (const edge of node.children) {
    edge.isLatestPath = false;
    if (!isTerminalOutcome(edge.child)) {
      clearLatestPath(edge.child);
    }
  }
}

let nodeCounter = 0;

function nextNodeId(): string {
  return `n${nodeCounter++}`;
}

export function convertLinearToTree(linear: RecordedCall): RecordedCallTree {
  nodeCounter = 0;

  const root: TreeNode = {
    id: nextNodeId(),
    ivrSpeech: linear.turns[0]?.ivrSpeech ?? '',
    children: [],
  };

  let currentNode = root;
  for (let i = 0; i < linear.turns.length; i++) {
    const turn = linear.turns[i];
    const isLast = i === linear.turns.length - 1;

    const child: TreeNode | TerminalOutcome = isLast
      ? {
          terminal: true,
          finalStatus: linear.outcome.finalStatus,
          durationSeconds: linear.outcome.durationSeconds,
          reachedHuman: linear.outcome.reachedHuman,
          dtmfDigits: linear.outcome.dtmfDigits,
        }
      : {
          id: nextNodeId(),
          ivrSpeech: linear.turns[i + 1].ivrSpeech,
          children: [],
        };

    const edge: TreeEdge = {
      aiAction: turn.aiAction,
      recordedAt: linear.recordedAt,
      isLatestPath: true,
      child,
    };

    currentNode.children.push(edge);
    if (!isTerminalOutcome(child)) {
      currentNode = child;
    }
  }

  return {
    version: 2,
    id: linear.testCaseId,
    testCaseId: linear.testCaseId,
    lastRecordedAt: linear.recordedAt,
    config: linear.config,
    root,
  };
}

export function loadFixture(filePath: string): RecordedCallTree {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (raw.version === 2) return raw as RecordedCallTree;
  return convertLinearToTree(raw as RecordedCall);
}

interface RecordedPathTurn {
  ivrSpeech: string;
  aiAction: CallAction;
}

interface RecordedPathOutcome {
  finalStatus: string;
  durationSeconds: number;
  reachedHuman: boolean;
  dtmfDigits: Array<string>;
}

export function mergePathIntoTree(
  tree: RecordedCallTree,
  turns: Array<RecordedPathTurn>,
  outcome: RecordedPathOutcome
): RecordedCallTree {
  if (turns.length === 0) return tree;

  nodeCounter = 0;
  // Find max existing node id to avoid collisions
  const maxId = findMaxNodeId(tree.root);
  nodeCounter = maxId + 1;

  clearLatestPath(tree.root);

  let cursor = tree.root;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const isLast = i === turns.length - 1;

    // Verify speech matches at this node
    if (!isSpeechMatch(cursor.ivrSpeech, turn.ivrSpeech)) {
      // Speech diverged — this shouldn't normally happen for the first node,
      // but for mid-tree divergence, create a new branch from parent.
      // For simplicity, update the node's speech if it's the root on first recording.
      if (cursor === tree.root && cursor.children.length === 0) {
        cursor.ivrSpeech = turn.ivrSpeech;
      }
    }

    // Find existing matching edge
    const existingEdge = cursor.children.find(edge =>
      edgeMatchesAction(edge, turn.aiAction)
    );

    if (existingEdge) {
      existingEdge.isLatestPath = true;
      existingEdge.recordedAt = new Date().toISOString();

      if (isLast) {
        existingEdge.child = {
          terminal: true,
          finalStatus: outcome.finalStatus,
          durationSeconds: outcome.durationSeconds,
          reachedHuman: outcome.reachedHuman,
          dtmfDigits: outcome.dtmfDigits,
        };
      } else if (isTerminalOutcome(existingEdge.child)) {
        // Path extends past where a previous recording ended — replace terminal with new node
        const newNode: TreeNode = {
          id: nextNodeId(),
          ivrSpeech: turns[i + 1]?.ivrSpeech ?? '',
          children: [],
        };
        existingEdge.child = newNode;
        cursor = newNode;
      } else {
        cursor = existingEdge.child;
      }
    } else {
      // Create new edge + child
      const child: TreeNode | TerminalOutcome = isLast
        ? {
            terminal: true,
            finalStatus: outcome.finalStatus,
            durationSeconds: outcome.durationSeconds,
            reachedHuman: outcome.reachedHuman,
            dtmfDigits: outcome.dtmfDigits,
          }
        : {
            id: nextNodeId(),
            ivrSpeech: turns[i + 1]?.ivrSpeech ?? '',
            children: [],
          };

      const newEdge: TreeEdge = {
        aiAction: turn.aiAction,
        recordedAt: new Date().toISOString(),
        isLatestPath: true,
        child,
      };

      cursor.children.push(newEdge);
      if (!isTerminalOutcome(child)) {
        cursor = child;
      }
    }
  }

  tree.lastRecordedAt = new Date().toISOString();
  return tree;
}

function findMaxNodeId(node: TreeNode): number {
  const num = parseInt(node.id.replace(/^n/, ''), 10) || 0;
  let max = num;
  for (const edge of node.children) {
    if (!isTerminalOutcome(edge.child)) {
      max = Math.max(max, findMaxNodeId(edge.child));
    }
  }
  return max;
}

export function getLatestPath(
  tree: RecordedCallTree
): Array<{ node: TreeNode; edge: TreeEdge }> {
  const path: Array<{ node: TreeNode; edge: TreeEdge }> = [];
  let cursor: TreeNode = tree.root;

  const maxDepth = 100;
  let depth = 0;

  while (depth++ < maxDepth) {
    const latestEdge = cursor.children.find(e => e.isLatestPath);
    if (!latestEdge) break;

    path.push({ node: cursor, edge: latestEdge });
    if (isTerminalOutcome(latestEdge.child)) break;
    cursor = latestEdge.child;
  }

  return path;
}

export function saveTreeFixture(
  filePath: string,
  tree: RecordedCallTree
): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(tree, null, 2));
  fs.renameSync(tmpPath, filePath);
}
