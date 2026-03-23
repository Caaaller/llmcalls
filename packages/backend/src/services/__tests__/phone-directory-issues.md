# Phone Directory Call Issues

Issues discovered while calling numbers from `phone-directory.json` (PCMag phone directory).

## Bug 1: AI chooses dishonest IVR options to reach a human faster

**Status:** Fix applied, prompt eval test added

**What happens:** When the IVR offers both a truthful option ("say I don't have one") and a dishonest shortcut ("press # to become a new customer"), the AI picks the dishonest shortcut because it's more likely to reach a human.

**Example — Verizon FiOS:**
The AI's phone number didn't match any account. The IVR then said:

> "To become a new customer, you can say new customer or press the pound key, or you can say, I don't have one."

The AI pressed `#` (new customer) instead of saying "I don't have one." Its reasoning: "since no representative option is available and the menu appears complete enough to act, choose the available path most likely to reach a human."

**Fix:** Added `[Honesty — never lie or misrepresent]` section to the prompt. Added prompt eval test `DTMF - Verizon FiOS Honesty Over Shortcut`.

---

## Bug 2: Account-gated IVRs block progress when caller has no account

**Status:** Documented, not yet addressed

**What happens:** Many cable/telecom companies require account verification (phone number, account number, ZIP code) before routing to a representative. The AI provides the user's phone number (as instructed), but it doesn't match any account, and the IVR gets stuck.

**Affected companies:** AT&T U-verse, Cablevision (Optimum), Charter (Spectrum), Comcast (Xfinity), DirecTV, Verizon FiOS

**Example — Cablevision (Optimum):**

1. IVR: "Please say or enter the 10-digit phone number on your account"
2. AI provides the user's phone number
3. IVR: "Sorry, I couldn't find an account with that phone number"
4. IVR: "Please say or enter your account number"
5. AI: "I don't have my account number. Can I speak with a representative?"
6. IVR: "Please tell me the ZIP code associated with your account"
7. AI: "I don't have that information"
8. Call stalls

**Proposed solution:** When the IVR is blocking on information that the AI doesn't have (and `request_info` hasn't triggered because it's a phone number, not an account number), we should detect the stall pattern and use `request_info` to ask the user for their actual account phone number or ZIP code. Not addressing yet.

---

## Bug 3: Asus DTMF digits not recognized

**Status:** Reproduced twice, root cause unknown

**What happens:** The AI correctly identifies the right menu option and sends DTMF, but Asus's IVR consistently responds "I did not recognize that as a valid entry." This happened across two separate calls with digits 2, 4, and 2 again.

**Possible causes:**

- DTMF sent while IVR is still speaking (timing issue)
- DTMF tone duration too short for Asus's system
- Asus IVR expects input during prompt playback (barge-in), not after

**Transcript excerpt (both calls identical behavior):**

```
IVR: "for notebooks, tablet, mobile or desktop PC support, please press 2"
DTMF: 2
IVR: "I did not recognize that as a valid entry"
```

This may affect other IVRs silently (where the system just ignores the input instead of explicitly rejecting it).

---

## Bug 4: AI picks wrong "catch-all" option

**Status:** Fix applied, prompt eval test added

**What happens:** When no menu option says "representative" or "other," the AI sometimes picks a semantically wrong option as a catch-all.

**Example — DJI:**
Menu: `1=drones, 2=handheld, 4=care plans, 9=existing order, #=repeat`

The AI chose `9` (existing order) with reasoning: "no representative option was provided, choose the available catch-all/next option." This is wrong — "existing order" is not a catch-all. The AI self-corrected on the next loop and pressed `1` (tech support), which worked.

**Fix:** Added prompt eval test `DTMF - DJI No False Catch-All` to verify the AI picks tech support (`1`) over existing order (`9`).

---

## Bug 5: Motorola — AI confirms wrong phone number as its own

**Status:** Documented, not yet addressed

**What happens:** Motorola's IVR detected the Twilio caller ID and asked "Are you calling about mobile number 1-719-982-2499?" The AI said "Yes" and pressed 1, but that's the Twilio outbound number, not the user's mobile number. The AI then got routed into a Razr phone support flow it didn't want.

**Why it matters:** The AI shouldn't confirm ownership of phone numbers it doesn't actually own. This is related to Bug 1 (honesty) — the AI is misrepresenting its situation to progress through the IVR.

---

## Bug 6: LG speech-based IVR — AI forced into wrong path

**Status:** Documented, not yet addressed

**What happens:** LG's IVR is entirely speech-based and insists on categorizing the call as "order", "part", or "filter." When the AI said "I need help with a question and would like to speak with a representative," the IVR replied "Sorry I didn't get it" and repeated the three options. The AI eventually said "order" just to progress, which routed it into order-tracking menus.

**Why it matters:** Some speech-based IVRs have no "representative" or "other" option. The AI needs a strategy for these — possibly saying "agent" or "representative" more forcefully, or trying "other" / "something else."

---

## Observations (not bugs)

### Dead/defunct numbers

- **Google** (+18558363987): "We no longer take calls at this number"
- **HTC** (+18664498358): No answer
- **MakerBot** (+13473346800): Closed (likely defunct company)

### Closed (time-of-day dependent)

- **Canon USA** (+18008284040): "We are currently closed" — correctly terminated
- **Lenovo** (+18552536686): Reached menu, selected option 3, then "currently closed" — correctly terminated

### Dead ends

- **Epson** (+18005333731): After navigating through product category menus (printers → press 1), IVR said "Goodbye" and hung up
- **Time Warner Cable** (+18008922253): After pressing 2 for billing, redirected to "sales and promotions" then told to "call the customer service number on your billing statement"

### `request_info` working correctly

- **BlackBerry**: Asked for "customer number" → triggered `request_info`
- **Brother**: Asked for "model number" → triggered `request_info`
- **Dell**: Asked for "service tag" → triggered `request_info`
- **HP**: Asked for first and last name after navigating menu → triggered `request_info`

### Successful navigation

- **Cox Communications**: Pressed 1 for corporate offices → reached hold queue
- **Acer**: Pressed 2 for support → asked for SNID → said no → reached representative queue
- **DJI**: Eventually pressed 1 for tech support → reached hold queue
- **Belkin**: Pressed 2 for tech support → reached hold queue
- **Hulu**: DTMF menu (6 options), stayed on line → reached hold → live rep "Lisa" answered
- **Logitech**: Pressed 2 for product support, then sub-menu for product type (looping)
- **Microsoft**: Speech-based, said "home user" → conversational AI, said "account support" → routing
- **Netflix**: Pressed 1 for English → conversational AI → routing
- **Philips**: Two DTMF menus ("other products" → "other products") → **reached live human "Chen"**
- **Vizio**: Correctly said phone number was wrong, opted out of texts → **reached live human "Steffi"**
- **GameStop**: DTMF menus (press 4 → press 2) → hold → **reached live human "John", transferred successfully**
- **Sprint (→T-Mobile)**: Said "I don't have one" 3×, pressed 0 → reached hold queue
- **T-Mobile**: Said "I don't have one", said "new service" → reached hold queue with music
- **Samsung**: Speech-based AI, said "TV", declined text option → routing to rep

### Dead/defunct numbers (updated)

- **Google** (+18558363987): "We no longer take calls at this number"
- **HTC** (+18664498358): No answer
- **MakerBot** (+13473346800): Closed (likely defunct company)
- **Swagway** (+18442990625): No answer — defunct
- **Olympus** (+18885534448): Call failed — number disconnected
- **Virgin Mobile** (+18883221122): "Number not available from your calling area" — defunct
- **Toshiba** (+18004577777): Number now appears to belong to different company ("Binder" support)
- **Xbox** (+18004699269): No phone support — directs to xbox.com/help, then hangs up

### Closed (time-of-day dependent)

- **Canon USA** (+18008284040): Correctly terminated
- **Lenovo** (+18552536686): Correctly terminated
- **Nikon** (+18006456678): Correctly terminated
- **Panasonic** (+18002117262): Correctly terminated
- **PlayStation** (+18003457669): Correctly terminated
- **Sharp** (+18002374277): Correctly terminated

### Dead ends

- **Epson** (+18005333731): Navigated product menus → "Goodbye" → hung up
- **Time Warner Cable** (+18008922253): Billing → "call customer service number on billing statement"
- **Sony** (+18002227669): Tried both menu options → "having difficulty, goodbye"
- **Valve** (+14258899642): Pressed 0 for general → 2 minutes of silence (likely voicemail/abandoned)

### `request_info` working correctly

- **BlackBerry**: Asked for "customer number" → triggered `request_info`
- **Brother**: Asked for "model number" → triggered `request_info`
- **Dell**: Asked for "service tag" → triggered `request_info`
- **HP**: Asked for first and last name after navigating menu → triggered `request_info`
- **eBay**: Asked for ZIP code after phone number → triggered `request_info`
- **Straight Talk**: Asked for IMEI number → triggered `request_info`

### Account-gated (phone number didn't match, call stalled)

- **AT&T U-verse**, **Cablevision (Optimum)**, **DirecTV**, **Verizon FiOS**: See Bug 2
- **Boost Mobile**: Phone didn't match, said "I don't have it", then stuck asking for keywords
- **Metro PCS (→Metro by T-Mobile)**: Pressed 3 for "something else", stalled

### Interesting behaviors

- **Nintendo**: Pressed 1 for Switch support but IVR said "not enough info to route" and looped — may need a sub-selection
- **Razer**: Very long menu with many product categories, incomplete menu detection working but slow
- **Costco (online)**: Got into Citi Visa credit card submenu instead of reaching a person — different number than the warehouse Costco already in test suite
