import {
  convertLinearToTree,
  mergePathIntoTree,
  getLatestPath,
} from './treeUtils';
import type {
  RecordedCall,
  RecordedCallTree,
  TreeNode,
} from './recordedCallTypes';
import { isTerminalOutcome } from './recordedCallTypes';
import type { CallAction } from '../ivrNavigatorService';

function makeAction(action: CallAction['action'], digit?: string): CallAction {
  return {
    action,
    digit,
    reason: 'test',
    detected: {
      isIVRMenu: false,
      menuOptions: [],
      isMenuComplete: false,
      loopDetected: false,
      shouldTerminate: false,
      transferRequested: false,
    },
  };
}

function makeLinearFixture(turnCount: number): RecordedCall {
  const turns = Array.from({ length: turnCount }, (_, i) => ({
    turnNumber: i + 1,
    ivrSpeech: `IVR speech turn ${i + 1}`,
    aiAction: makeAction(
      i % 2 === 0 ? 'press_digit' : 'wait',
      i % 2 === 0 ? '1' : undefined
    ),
  }));

  return {
    id: 'test-case-2026-03-16',
    testCaseId: 'test-case',
    recordedAt: '2026-03-16T00:00:00.000Z',
    config: { callPurpose: 'test' },
    turns,
    outcome: {
      finalStatus: 'completed',
      durationSeconds: 60,
      reachedHuman: true,
      dtmfDigits: ['1'],
    },
  };
}

describe('convertLinearToTree', () => {
  it('converts a linear fixture to a tree chain', () => {
    const linear = makeLinearFixture(3);
    const tree = convertLinearToTree(linear);

    expect(tree.version).toBe(2);
    expect(tree.testCaseId).toBe('test-case');
    expect(tree.root.ivrSpeech).toBe('IVR speech turn 1');
    expect(tree.root.children).toHaveLength(1);

    // Walk the chain
    let node = tree.root;
    for (let i = 0; i < 3; i++) {
      expect(node.children).toHaveLength(1);
      const edge = node.children[0];
      expect(edge.isLatestPath).toBe(true);
      expect(edge.aiAction.action).toBe(linear.turns[i].aiAction.action);

      if (i < 2) {
        expect(isTerminalOutcome(edge.child)).toBe(false);
        node = edge.child as TreeNode;
      } else {
        expect(isTerminalOutcome(edge.child)).toBe(true);
      }
    }
  });

  it('handles single-turn fixture', () => {
    const linear = makeLinearFixture(1);
    const tree = convertLinearToTree(linear);

    expect(tree.root.children).toHaveLength(1);
    expect(isTerminalOutcome(tree.root.children[0].child)).toBe(true);
  });

  it('handles empty turns', () => {
    const linear = makeLinearFixture(0);
    linear.turns = [];
    const tree = convertLinearToTree(linear);

    expect(tree.root.ivrSpeech).toBe('');
    expect(tree.root.children).toHaveLength(0);
  });
});

describe('mergePathIntoTree', () => {
  it('merges a path into an empty tree', () => {
    const tree: RecordedCallTree = {
      version: 2,
      id: 'test',
      testCaseId: 'test',
      lastRecordedAt: '',
      config: { callPurpose: 'test' },
      root: { id: 'n0', ivrSpeech: 'Welcome', children: [] },
    };

    const turns = [
      { ivrSpeech: 'Welcome', aiAction: makeAction('press_digit', '1') },
      { ivrSpeech: 'Billing menu', aiAction: makeAction('press_digit', '2') },
    ];

    const outcome = {
      finalStatus: 'completed',
      durationSeconds: 30,
      reachedHuman: true,
      dtmfDigits: ['1', '2'],
    };

    mergePathIntoTree(tree, turns, outcome);

    expect(tree.root.children).toHaveLength(1);
    expect(tree.root.children[0].isLatestPath).toBe(true);
    expect(tree.root.children[0].aiAction.digit).toBe('1');

    const secondNode = tree.root.children[0].child as TreeNode;
    expect(secondNode.ivrSpeech).toBe('Billing menu');
    expect(secondNode.children).toHaveLength(1);
    expect(isTerminalOutcome(secondNode.children[0].child)).toBe(true);
  });

  it('creates a branch when AI takes different action', () => {
    const linear = makeLinearFixture(2);
    const tree = convertLinearToTree(linear);

    // Record a new path that presses '3' instead of '1' at turn 1
    const turns = [
      {
        ivrSpeech: 'IVR speech turn 1',
        aiAction: makeAction('press_digit', '3'),
      },
      { ivrSpeech: 'Different menu', aiAction: makeAction('speak') },
    ];

    const outcome = {
      finalStatus: 'completed',
      durationSeconds: 45,
      reachedHuman: false,
      dtmfDigits: ['3'],
    };

    mergePathIntoTree(tree, turns, outcome);

    // Root should now have 2 edges
    expect(tree.root.children).toHaveLength(2);

    // Old edge should not be latest
    const oldEdge = tree.root.children.find(e => e.aiAction.digit === '1');
    expect(oldEdge?.isLatestPath).toBe(false);

    // New edge should be latest
    const newEdge = tree.root.children.find(e => e.aiAction.digit === '3');
    expect(newEdge?.isLatestPath).toBe(true);
  });

  it('reuses existing edge when same action is taken', () => {
    const linear = makeLinearFixture(2);
    const tree = convertLinearToTree(linear);

    // Record same path again
    const turns = [
      {
        ivrSpeech: 'IVR speech turn 1',
        aiAction: makeAction('press_digit', '1'),
      },
      { ivrSpeech: 'IVR speech turn 2', aiAction: makeAction('wait') },
    ];

    const outcome = {
      finalStatus: 'completed',
      durationSeconds: 50,
      reachedHuman: true,
      dtmfDigits: ['1'],
    };

    mergePathIntoTree(tree, turns, outcome);

    // Should still have just 1 edge at root (reused)
    expect(tree.root.children).toHaveLength(1);
    expect(tree.root.children[0].isLatestPath).toBe(true);
  });

  it('clears all isLatestPath flags globally before merging', () => {
    const tree: RecordedCallTree = {
      version: 2,
      id: 'test',
      testCaseId: 'test',
      lastRecordedAt: '',
      config: { callPurpose: 'test' },
      root: {
        id: 'n0',
        ivrSpeech: 'Welcome',
        children: [
          {
            aiAction: makeAction('press_digit', '1'),
            recordedAt: '2026-03-16T00:00:00.000Z',
            isLatestPath: true,
            child: {
              id: 'n1',
              ivrSpeech: 'Billing',
              children: [
                {
                  aiAction: makeAction('press_digit', '2'),
                  recordedAt: '2026-03-16T00:00:00.000Z',
                  isLatestPath: true,
                  child: {
                    terminal: true,
                    finalStatus: 'completed',
                    durationSeconds: 30,
                    reachedHuman: true,
                    dtmfDigits: ['1', '2'],
                  },
                },
              ],
            },
          },
          {
            aiAction: makeAction('press_digit', '9'),
            recordedAt: '2026-03-15T00:00:00.000Z',
            isLatestPath: false,
            child: {
              terminal: true,
              finalStatus: 'completed',
              durationSeconds: 20,
              reachedHuman: false,
              dtmfDigits: ['9'],
            },
          },
        ],
      },
    };

    // Record path through digit 9
    const turns = [
      { ivrSpeech: 'Welcome', aiAction: makeAction('press_digit', '9') },
    ];
    const outcome = {
      finalStatus: 'completed',
      durationSeconds: 25,
      reachedHuman: false,
      dtmfDigits: ['9'],
    };

    mergePathIntoTree(tree, turns, outcome);

    // Digit 1 branch should have isLatestPath=false
    const digit1Edge = tree.root.children.find(e => e.aiAction.digit === '1');
    expect(digit1Edge?.isLatestPath).toBe(false);

    // Its child edge should also be false
    const digit1Child = digit1Edge?.child as TreeNode;
    expect(digit1Child.children[0].isLatestPath).toBe(false);

    // Digit 9 should be latest
    const digit9Edge = tree.root.children.find(e => e.aiAction.digit === '9');
    expect(digit9Edge?.isLatestPath).toBe(true);
  });

  it('matches press_digit on action+digit, speak on action only', () => {
    const tree: RecordedCallTree = {
      version: 2,
      id: 'test',
      testCaseId: 'test',
      lastRecordedAt: '',
      config: { callPurpose: 'test' },
      root: {
        id: 'n0',
        ivrSpeech: 'Welcome',
        children: [
          {
            aiAction: makeAction('speak'),
            recordedAt: '2026-03-16T00:00:00.000Z',
            isLatestPath: true,
            child: {
              terminal: true,
              finalStatus: 'completed',
              durationSeconds: 10,
              reachedHuman: false,
              dtmfDigits: [],
            },
          },
        ],
      },
    };

    // Speak action with different text should match existing speak edge
    const speakAction = makeAction('speak');
    speakAction.speech = 'completely different text';

    const turns = [{ ivrSpeech: 'Welcome', aiAction: speakAction }];
    const outcome = {
      finalStatus: 'completed',
      durationSeconds: 15,
      reachedHuman: false,
      dtmfDigits: [],
    };

    mergePathIntoTree(tree, turns, outcome);

    // Should reuse existing edge, not create a new one
    expect(tree.root.children).toHaveLength(1);
  });

  it('handles empty turns without corrupting isLatestPath flags', () => {
    const linear = makeLinearFixture(2);
    const tree = convertLinearToTree(linear);

    // All edges should be isLatestPath=true
    expect(tree.root.children[0].isLatestPath).toBe(true);

    // Merge empty turns — should be a no-op
    mergePathIntoTree(tree, [], {
      finalStatus: 'completed',
      durationSeconds: 0,
      reachedHuman: false,
      dtmfDigits: [],
    });

    // Flags should still be true (not cleared)
    expect(tree.root.children[0].isLatestPath).toBe(true);
  });

  it('extends past a terminal outcome when new path is longer', () => {
    const tree: RecordedCallTree = {
      version: 2,
      id: 'test',
      testCaseId: 'test',
      lastRecordedAt: '',
      config: { callPurpose: 'test' },
      root: {
        id: 'n0',
        ivrSpeech: 'Welcome',
        children: [
          {
            aiAction: makeAction('press_digit', '1'),
            recordedAt: '2026-03-16T00:00:00.000Z',
            isLatestPath: true,
            child: {
              terminal: true,
              finalStatus: 'completed',
              durationSeconds: 10,
              reachedHuman: false,
              dtmfDigits: ['1'],
            },
          },
        ],
      },
    };

    // New recording goes deeper — press 1, then press 2
    const turns = [
      { ivrSpeech: 'Welcome', aiAction: makeAction('press_digit', '1') },
      { ivrSpeech: 'Billing menu', aiAction: makeAction('press_digit', '2') },
    ];
    const outcome = {
      finalStatus: 'completed',
      durationSeconds: 20,
      reachedHuman: true,
      dtmfDigits: ['1', '2'],
    };

    mergePathIntoTree(tree, turns, outcome);

    // First edge child should now be a TreeNode, not terminal
    const firstChild = tree.root.children[0].child;
    expect(isTerminalOutcome(firstChild)).toBe(false);
    const node = firstChild as TreeNode;
    expect(node.ivrSpeech).toBe('Billing menu');
    expect(node.children).toHaveLength(1);
    expect(isTerminalOutcome(node.children[0].child)).toBe(true);
  });
});

describe('getLatestPath', () => {
  it('returns the path following isLatestPath edges', () => {
    const linear = makeLinearFixture(3);
    const tree = convertLinearToTree(linear);

    const path = getLatestPath(tree);
    expect(path).toHaveLength(3);
    expect(path[0].node.ivrSpeech).toBe('IVR speech turn 1');
  });

  it('returns empty for a tree with no latest path', () => {
    const tree: RecordedCallTree = {
      version: 2,
      id: 'test',
      testCaseId: 'test',
      lastRecordedAt: '',
      config: { callPurpose: 'test' },
      root: { id: 'n0', ivrSpeech: 'Welcome', children: [] },
    };

    const path = getLatestPath(tree);
    expect(path).toHaveLength(0);
  });
});
