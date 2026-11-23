# GlancePulse v2.0 — Voice-First Telegram & Live Market Focus-Card Copilot for Even Realities G2

Built for the **Heads Up: Even Realities Hackathon** targeting **Track 02 (Crypto & DeFi)**, **Special Prize (Best Telegram Integration)**, and **Grand Prize**.

- **Live Browser G2 Optical Simulator**: https://lhortl.github.io/glancepulse-g2/
- **HD Demo Walkthrough Video (75s, 1280×720)**: https://github.com/LHorTL/glancepulse-g2/releases/download/v2.0.0/glancepulse-v2-demo.mp4
- **Pre-Built EvenHub `.ehpk` Package (v2.0.0)**: https://github.com/LHorTL/glancepulse-g2/releases/tag/v2.0.0 (`min_app_version 2.2.10`, SDK `0.0.16`)

![GlancePulse v2.0 G2 Optical Waveguide HUD](./assets/preview-hud.png)

> *"It shows one thing that matters, then lets you act on it in seconds: reply by voice, confirm with a tap on the glasses or the R1 ring."*

## What Makes GlancePulse v2.0 Different

Instead of cramming a noisy 4-tab ticker onto smart glasses, **GlancePulse v2.0** fuses **Telegram Read + Threaded Write**, **live Hyperliquid perpetuals + 24h candles**, and **filtered crypto/macro Polymarket odds** into a single **4-Second Quiet-Tech Loop** on Even Realities G2 (`576×288` 4-bit monochrome green waveguide):

1. **Heads-Up Focus Card (Default View)**:
   - Displays **one priority unread Telegram message or channel post** (`getUpdates` with `offset = update_id + 1` and `allowed_updates=["message","channel_post"]`).
   - **Auto-links mentioned market entities** (`BTC`, `ETH`, `SOL`, `HYPE`, `SUI`, `ARB`, `Fed`, `FOMC`, `Polymarket`) in real time and renders the matching live **Hyperliquid mark/funding** or **Polymarket YES/NO odds** right beside the message.
2. **Real 4-Bit Grayscale Graphics (`ImageContainerProperty` + `updateImageRawData`)**:
   - Zero-dependency pure-JS grayscale PNG generator pushes live **24h Hyperliquid sparklines** (via `candleSnapshot`), **Polymarket probability gauges**, and **16-bar live microphone waveforms** directly to G2's `184×84` image container.
3. **Hands-Free G2 Mic Voice Reply (`audioControl` + `AudioEvent` + `EventSourceType`)**:
   - Hold the **R1 Ring** or **Right/Left Temple** (`LONG_PRESS_EVENT` → `audioControl(true, AudioInputSource.Glasses)` → `LONG_PRESS_RELEASE_EVENT`) to capture 16kHz PCM16 voice with `speakerRole` self-speech detection and real-time waveform bars.
   - Includes Web Speech API live dictation and a **1-Click Voice Demo** in the browser simulator so judges without G2 hardware can test the complete loop immediately.
4. **IMU Head-Nod Confirm / Head-Shake Cancel (`imuControl` + `IMU_DATA_REPORT`)**:
   - Once a voice or smart reply draft is previewed on the G2 lens, **Nod your head** (or 1-tap R1 ring/temple) to dispatch a real **threaded Telegram reply** (`reply_to_message_id`), or **Shake your head** (or double-tap) to cancel. IMU turns off automatically when idle to save battery.
5. **Hardware-Authentic G2 Protocol Hardening**:
   - **Proto3 zero-value safety**: Handles omitted `0`/`undefined` on `CLICK_EVENT` and Row-0 `currentSelectItemIndex` with `currentSelectItemName` fallback.
   - **Zero flicker & zero double-scroll**: Serialized BLE queue uses incremental `textContainerUpgrade` + `updateImageRawData` on 30s refreshes instead of flashing `rebuildPageContainer`.
   - **Real G2 ~21px typography budgets**: Every container is strictly bounded (`≤ 38` chars header/footer, `≤ 26` chars × `≤ 3` lines card, `borderColor: 8..10` on true `0..15` 4-bit grayscale scale) so zero text clips in physical G2 firmware or the official `@evenrealities/evenhub-simulator`.
   - **Clean Crypto/Macro Polymarket Feed**: Queries `/markets/keyset` with `end_date_min`, filters out sports (`vs.`, NFL/NBA/soccer) and settled odds (`< 5%` or `> 95%`), and ranks Crypto/Fed/FOMC markets first.

## Quick Start

```bash
npm install
npm test            # Run 16 unit tests (SDK validation, PNG sparklines, proto3, IMU, Telegram/Worker, Polymarket)
npm run dev         # Launch browser G2 optical simulator & companion console
npm run build       # Production Vite bundle -> dist/
npm run pack:g2     # Build EvenHub .ehpk package (v2.0.0)
```

### Testing in Official EvenHub Simulator

```bash
npm run dev
npx @evenrealities/evenhub-simulator http://localhost:5173
```

## G2 Temple / R1 Ring / IMU Controls (Keyboard Shortcuts in Simulator)

| Hardware Gesture | Simulator Key | Action |
|---|---|---|
| Scroll Up / Down | `W` / `S` or `↑` / `↓` | Move list highlight + refresh sparkline/detail (`textContainerUpgrade` + `updateImageRawData`) |
| Single Tap | `Enter` | Execute action / Confirm pending Telegram reply / Toggle market alert |
| Hold Temple / R1 Ring | `V` (or `1-Click Voice Demo`) | Push-to-talk G2 Mic capture (`audioControl(Glasses)`) → release to preview draft |
| IMU Head Nod | `N` | Hands-free confirm & send pending threaded Telegram reply (`IMU_DATA_REPORT`) |
| IMU Head Shake | `X` | Hands-free cancel pending draft (`IMU_DATA_REPORT`) |
| Double Tap | `D` | Next Telegram message (`FOCUS`) / Cancel draft / Push live Pulse (`PERPS`/`MARKETS`) |
| Long Press Tab Switch / Menu | `Tab` / `M` | Switch screens (`FOCUS` · `PERPS` · `MARKETS` · `VOICE`) or open G2 `MenuContainerProperty` |

## Packaging, CORS Relay & Privacy

- `app.json` declares minimal permissions: `network` (`gamma-api.polymarket.com`, `api.hyperliquid.xyz`, `api.telegram.org`) and `g2-microphone`.
- Zero hardcoded tokens or secrets — Telegram credentials, pagination `offset`, and armed alerts are stored strictly in EvenHub / browser local storage.
- For standalone desktop browser testing outside Even App WebView (where Telegram Bot API omits CORS headers on JSON `POST`), deploy the included 45-line zero-secret [proxy/cloudflare-worker.js](./proxy/cloudflare-worker.js) and paste its URL into the optional **CORS Proxy URL** field.

## License

MIT — see [LICENSE](./LICENSE).
