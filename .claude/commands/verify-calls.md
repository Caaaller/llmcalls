Verify the results of live test calls by examining actual transcripts from MongoDB. NEVER trust the test framework's pass/fail verdict alone.

This skill is MANDATORY after every `test:live:record` or `test:replay-or-live` run.

## Steps

### 1. Query MongoDB for every call's transcript

```bash
cd $WORKTREE_PATH/packages/backend
export "MONGODB_URI=mongodb://llmcalls:Llmcalls2026%21prod@ac-uumrnmx-shard-00-01.p6de3bm.mongodb.net:27017/llmcalls?ssl=true&authSource=admin&directConnection=true"
node -e "
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Call = mongoose.model('CallHistory', new mongoose.Schema({}, { strict: false, collection: 'callhistories' }));
  const calls = await Call.find().sort({ startTime: -1 }).limit(9).lean();
  for (const c of calls.reverse()) {
    const to = c.metadata?.to || '?';
    const events = c.events || [];
    console.log('--- ' + to + ' | ' + c.status + ' | ' + events.length + ' events ---');
    for (const e of events) {
      const t = e.timestamp ? new Date(e.timestamp).toISOString().slice(11,19) : '?';
      const detail = (e.text || e.reason || e.digit || '').slice(0, 120);
      console.log('  ' + t + ' ' + (e.eventType + '/' + (e.type||'')).padEnd(18) + detail);
    }
    console.log('');
  }
  await mongoose.disconnect();
})();
"
```

Replace `$WORKTREE_PATH` with the actual worktree path.

### 2. For EACH call, answer these questions honestly

Go through every call one by one. For each, answer:

1. **Did the AI reach a real human?** Look for a human introducing themselves by name, asking personal questions conversationally, or saying something only a human would say. IVR bots saying "How can I help you?" does NOT count.

2. **Did the AI ask the confirmation question?** Look for an AI event containing "am I speaking with a live agent" or "did I reach a human" BEFORE any transfer event. If there is no such AI event, the confirmation step DID NOT happen — do not assume it happened but wasn't logged.

3. **Did the call end legitimately?** Valid endings: human reached and transferred, business closed and terminated, hold queue reached and waiting. Invalid endings: IVR hung up on us, AI went silent, call ended mid-IVR-navigation, transferred to a bot instead of a human.

4. **Were the AI's responses appropriate?** Did it use the IVR's suggested phrases? Did it answer questions? Or did it just repeat "representative" endlessly?

### 3. Report format

For EACH call, report a single row:

| Company | Events | Reached human? | Confirmation asked? | Transferred? | End reason | Issues |

### 4. CRITICAL RULES — DO NOT VIOLATE

- **MANDATORY: Read the transcript text as the source of truth.** Never infer what happened from metadata alone (event count, confirmation count, transfer timing, status). Always read the actual `conversation/user` and `conversation/ai` text for every call. Quote exact phrases when reporting. If you catch yourself writing "likely a premature transfer" or "probably reached a bot" without having quoted specific text from the transcript, STOP and go read it.
- **Ground truth for "reached a human"** = a conversation/user event whose text contains a personal introduction ("This is Abdul", "My name is Casper", "You've reached Alex"), a natural question ("Who do I have the pleasure of speaking with?"), or speech only a human would say. Confirmation count = 0 does NOT mean "transferred to a bot" — verify with text.
- **NEVER say "the confirmation was probably asked but not logged."** If it's not in the events, it didn't happen.
- **NEVER say "the system is working better than the data shows."** The data IS the truth.
- **NEVER assume a fixture file matches the user's screenshot.** Always verify against MongoDB.
- **NEVER rationalize unexpected results.** If the data contradicts your expectation, report the data and investigate why.
- **If a call has fewer than 10 events and "passed", it's suspicious.** A real successful call typically has 15+ events.
- **If there's a transfer event but no human speech before it, the transfer was premature.** Verify by reading the conversation/user text immediately preceding the transfer.
- **If there's a hold event in the first 30 seconds of a call, it's likely a false positive.**

### 5. Final verdict

After examining all calls, give an honest summary:

- How many GENUINELY reached a human (not just "passed" the test)?
- How many had the confirmation step?
- How many ended prematurely?
- What needs to be fixed?
