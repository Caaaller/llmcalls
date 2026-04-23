# Self-Call Simulator Test — Setup

## What it does

A second Telnyx DID is configured to route inbound calls back to the same
`/voice` webhook we use for outbound calls. When `voiceRoutes` sees a
`call.initiated` event with `direction: 'incoming'` and `to ===
TELNYX_SIMULATOR_NUMBER`, it fires `runSimulatorFlow(callControlId)`, which:

1. Answers the call.
2. Pauses 0.8–2.5s (randomized pick-up delay).
3. Speaks a randomized human-style greeting (e.g. `"Hi, this is Alex with
customer service, how can I help you today?"`).
4. Pauses 4–6s (giving our test AI time to ask `"Am I speaking with a live
agent?"`).
5. Speaks a randomized confirmation (`"Yes, I'm a real person — how can I
help?"`).
6. Pauses 3–5s, speaks a short followup, then hangs up.

The outbound test leg, placed by `test:live:record` against the
`self-call-human-greeting` fixture, should: mark `maybe_human` on the
greeting → ask the confirmation question → upgrade to `human_detected` on
the scripted confirmation → fire a transfer. Fast (<30s), cheap, and
non-flaky.

Agent names, greeting templates, confirmation templates, followup
templates, and all pause durations are randomized per call so we're not
just re-running the same stimulus.

## Purchase + configure the simulator DID

The same webhook (already pointing at our ngrok URL via the call-control
app) handles all DIDs on the connection — no additional webhook config is
needed. Just buy a number and attach it to the existing connection.

```bash
# 1. Search for available US numbers
curl -X POST "https://api.telnyx.com/v2/available_phone_numbers/search" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filter": {"country_code": "US", "limit": 1, "features": ["voice"]}}'

# 2. Purchase the number (replace +1XXXXXXXXXX with a candidate from step 1)
curl -X POST "https://api.telnyx.com/v2/number_orders" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone_numbers": [{"phone_number": "+1XXXXXXXXXX"}]}'

# 3. Assign it to our call-control app (ID 2925946576717219034)
curl -X PATCH "https://api.telnyx.com/v2/phone_numbers/+1XXXXXXXXXX" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"connection_id": "2925946576717219034"}'

# 4. Set TELNYX_SIMULATOR_NUMBER=+1XXXXXXXXXX in .env and restart backend
```

## Safety

If `TELNYX_SIMULATOR_NUMBER` is unset, the simulator dispatch is skipped
entirely (see `isSimulatorInboundCall` in `voiceRoutes.ts`) and the
fixture is omitted from `DEFAULT_TEST_CASES`. The feature is therefore
inert until the DID is purchased and the env var is populated.

## Cost

~$1/month for the DID plus per-minute charges on inbound+outbound legs.
Trivial for test-only use (each run is <30s).
