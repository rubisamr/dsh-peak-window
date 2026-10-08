# dsh-peak-window

**A DeepSeek peak / off-peak badge for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) chat composer**: a coloured dot, the current rate class, and a live countdown to the next change.

DeepSeek bills off-peak requests at **half** the peak rate, so "which rate am I on right now, and when does it change?" belongs next to the chat box, not in a browser tab.

```
● Pico · Valle en 1h 42m          red    — peak, full rate
● Valle · Pico en 3h 08m          amber  — weekday off-peak, half rate
● Finde · Pico en 1d 6h           green  — weekend, all hours off-peak
```

Hover it for the schedule it is using.

## The schedule it follows

Published DeepSeek peak windows, **UTC, Monday to Friday only**:

| Window (UTC) | Rate |
| --- | --- |
| 01:00 – 04:00 | peak |
| 06:00 – 10:00 | peak |
| everything else, and the whole weekend | off-peak (half) |

Boundaries are half-open on the right: at 04:00 sharp it is already off-peak. All five boundary shapes are covered by tests.

## Why this exists

There is an earlier plugin that does the same job, `@imnotndesh/dsh-peak-pricing-warning`, and its *schedule* is right — this plugin uses the same windows and says so. But as published (1.0.0) it cannot show anything at all:

1. **Its host half never applies.** It exports a factory (`export default host`, a function) where the installed-package loader expects the descriptor object (`{ name, inject, apply }`), so it finds no `apply` and the status route is never registered — the route answers 404.
2. **Its client half throws while rendering.** It calls `resolveRates(model)` and reads `OFF_PEAK_MULTIPLIER`, and neither is defined or imported anywhere in the published package, so as soon as the session has token usage React throws `ReferenceError: resolveRates is not defined` and the slot renders **nothing** — no badge, no message, no error visible anywhere.

The practical result is a badge that says *"Pricing status unavailable"* on a fresh install, and then disappears entirely once you actually use the chat.

This plugin is an independent implementation of the same idea, written so that neither failure can happen:

- **The descriptor is an object** in `default`, and the route is registered **inside `ctx.inject(['webServer'])`**, so it survives the host re-creating that service. Registering it once in `apply` leaves it on a stale instance and 404s — the same symptom, different cause.
- **The client cannot blank the slot.** Rendering is wrapped, the response is validated, the last good status is kept when a refresh fails, and a failure paints an honest label instead of nothing.
- **The maths lives in one place.** The host computes the windows and sends `nowMs` plus both boundaries; the client only subtracts, so a skewed clock in the browser cannot make the countdown lie.
- **No credentials, no configuration.** One route, same origin as the GUI, and it refuses cross-origin requests.

## Install

From the DeepSeek Harness desktop app: **Plugins → add**, using the git URL (or a local checkout):

```
github:<you>/dsh-peak-window
```

or, for an npm-installed harness profile, from a terminal:

```
dsh plugin --profile <profile> add github:<you>/dsh-peak-window
```

The desktop app manages its own reserved profile, so add it from the app's Plugins page rather than the CLI. Restart the app (or the profile) afterwards: client code is composed when the host starts.

## Verify it is working

```
curl -s http://127.0.0.1:<gui-port>/dsh-peak-window/api/peak-status
```

That must return JSON like:

```json
{"nowMs":1791469645236,"peak":false,"weekend":false,
 "offPeakStartMs":1791453600000,"peakStartMs":1791507600000}
```

and the badge must be visible above the input of any chat with a DeepSeek model selected.

## Tests

```
npm test
```

The window maths (every boundary, both blocks, the gap between them, both weekend edges, the return to peak) and the route (serves JSON, no credentials needed, refuses a cross-origin browser, 404s elsewhere) are covered.

## Credit and licence

- The peak/off-peak **schedule** is DeepSeek's published pricing; see <https://api-docs.deepseek.com/quick_start/pricing>.
- The window-boundary maths is the same as in `@imnotndesh/dsh-peak-pricing-warning` (MIT, © Imnotndesh), kept deliberately so both plugins agree on when the rate changes. Thanks for the schedule and its boundary tests.
- This plugin: **MIT** — see [LICENSE](LICENSE).
