import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import TestRun from '../models/TestRun';

const router: RouterType = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      runId,
      startedAt,
      completedAt,
      status,
      totalTests,
      passedTests,
      failedTests,
      closedTests,
      testCases,
    } = req.body;

    if (!runId || !testCases) {
      res
        .status(400)
        .json({ success: false, error: 'runId and testCases required' });
      return;
    }

    // Build update doc; only include completedAt when provided so in-progress
    // writes don't overwrite a later-set value with undefined.
    const update: Record<string, unknown> = {
      runId,
      startedAt,
      status,
      totalTests,
      passedTests,
      failedTests,
      closedTests: closedTests || 0,
      testCases,
    };
    if (completedAt) update.completedAt = completedAt;

    const testRun = await TestRun.findOneAndUpdate({ runId }, update, {
      upsert: true,
      new: true,
      runValidators: true,
    });

    res.json({ success: true, testRun });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to save test run';
    res.status(500).json({ success: false, error: message });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const runs = await TestRun.find()
      .sort({ createdAt: -1 })
      .select('-testCases')
      .limit(100)
      .lean();
    res.json({ success: true, runs });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to list test runs';
    res.status(500).json({ success: false, error: message });
  }
});

router.get('/:runId', async (req: Request, res: Response) => {
  try {
    const run = await TestRun.findOne({ runId: req.params.runId }).lean();
    if (!run) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }
    res.json({ success: true, run });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to get test run';
    res.status(500).json({ success: false, error: message });
  }
});

router.delete('/:runId', async (req: Request, res: Response) => {
  try {
    await TestRun.deleteOne({ runId: req.params.runId });
    res.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to delete test run';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
