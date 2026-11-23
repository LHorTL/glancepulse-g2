# GlancePulse — Even Realities G2 Crypto, Prediction Market & Telegram HUD

Built for the **Heads Up: Even Realities Hackathon** targeting **Track 02 (Crypto & DeFi)** and **Special Prize (Best Telegram Integration)**.

![GlancePulse G2 Optical Waveguide HUD](./assets/preview-hud.png)

GlancePulse turns Even Realities G2 smart glasses (`576×288` monochrome waveguide optics) into a glanceable, hands-free **Read + Write** trading and messaging HUD:

- **Live Polymarket Odds (Gamma API)**: Real-time top-volume prediction markets, YES/NO probabilities, 24h volume, and 1-tap `±5%` odds-move alert arming.
- **Live Hyperliquid Perpetuals (Info API)**: Live `BTC / ETH / SOL / HYPE / SUI / ARB` mark prices, 24h delta, annualized funding rates, open interest, and 1-tap `±2%` price / funding-spike alerts.
- **Telegram Bot Integration (Read + Write)**:
  - **Read**: Streams unread Telegram Bot messages directly into the G2 HUD.
  - **Write**: 1-tap Quick Replies (`ACK - On it`, `HEDGE 50%`, `Call in 5m`, `Send Pulse`) from temple/ring taps via Telegram Bot `sendMessage`, plus automatic alert dispatch when armed market thresholds trigger.
- **100% Protocol-Validated `@evenrealities/even_hub_sdk`**:
  - Validates every `CreateStartUpPageContainer` and `RebuildPageContainer` payload using `validateEvenHubPageContainer`.
  - Uses incremental `TextContainerUpgrade` updates for flicker-free scrolling and toast confirmations.
  - Registers a native 7-action `MenuContainerProperty` contextual OS menu.
- **Built-in `576×288` G2 Optical Waveguide Simulator**:
  - Automatically engages when opened outside the Even Flutter WebView host so judges can test every screen, temple/ring gesture, and live API feed directly in a browser.

## Quick Start

```bash
npm install
npm test            # Run SDK protocol validation, parser, alert & Telegram unit tests
npm run dev         # Launch browser G2 simulator & companion console
npm run build       # Production Vite bundle -> dist/
npm run pack:g2     # Build signed EvenHub .ehpk package
```

## G2 Temple / Ring Controls (Keyboard Shortcuts in Browser Simulator)

| Gesture | Simulator Key | Action |
|---|---|---|
| Scroll Up / Down | `W` / `S` or `↑` / `↓` | Move list highlight + refresh detail card (`textContainerUpgrade`) |
| Single Tap | `Enter` | Context action (drill down / arm or disarm alert / send Telegram Quick Reply) |
| Double Tap | `D` | Immediately push live BTC/ETH/SOL + Top Polymarket Pulse snapshot to Telegram |
| Long Press | `Tab` | Cycle tabs (`PULSE` → `POLYMARKET` → `HYPERLIQUID` → `TELEGRAM`) |
| OS Menu | `M` | Open Even G2 `MenuContainerProperty` action overlay |

## Packaging & Privacy

- Network whitelist declared cleanly in `app.json` (`gamma-api.polymarket.com`, `api.hyperliquid.xyz`, `api.telegram.org`).
- Zero hardcoded API keys or Telegram bot tokens — credentials are stored strictly in on-device EvenHub localStorage / browser localStorage.

## License

MIT — see [LICENSE](./LICENSE).
