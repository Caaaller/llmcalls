# Product: Automated Customer Service Caller

## What It Does

Gets a human customer support agent on the phone on behalf of the user. The user provides:

- A phone number to call
- An objective (e.g. "speak with credit card fraud department", "cancel my subscription", or just "speak with a representative")
- Optionally: specific instructions, account details, or context

The system calls the number, navigates IVR menus, waits on hold, and transfers the user once a human agent is connected.

## Core Principle

**The AI should use common sense to navigate calls, not micromanaged heuristics.** Given the objective and conversation history, the AI decides what to do on each turn — press a digit, say something, wait silently, or signal that a human is on the line. One model call per turn, not 10+ fragmented classifiers.

## How It Works

1. **User initiates a call** with a phone number and objective
2. **System calls the number** via Twilio
3. **On each speech/audio event**, the AI receives:
   - The user's objective and any custom instructions
   - Full conversation history (what the IVR said, what we did)
   - The latest speech transcript from the phone system
4. **AI decides the next action** (single structured response):
   - `press_digit` — press a DTMF tone (1-9, 0, \*, #)
   - `speak` — say something out loud
   - `wait` — stay silent, keep listening
   - `human_detected` — a real person is on the line, transfer the user
   - `hang_up` — dead end (voicemail, closed, wrong number)
5. **Once a human is detected**, the system transfers the call to the user

## Key Behaviors

- **IVR menus**: Pick the option that best matches the objective. If nothing matches, use common sense (operator, general inquiries, etc.)
- **Direct questions** (e.g. "what is your account number?"): Answer if the user provided the info, otherwise say "I'd like to speak with a representative"
- **Hold music / silence**: Wait patiently
- **Loops**: If stuck repeating the same menu, try a different option or press 0
- **Voicemail / closed**: Hang up and notify the user
- **Human on the line**: Confirm it's a real person, then transfer

## What It Is NOT

- Not a full conversation bot — it navigates menus and hold queues, then hands off
- Not a data entry system — it doesn't fill out forms or provide sensitive info unless explicitly told to
- Not a general-purpose voice assistant — it has one job: get a human on the phone
