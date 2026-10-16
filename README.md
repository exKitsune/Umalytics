# Umalytics

A replay and telemetry viewer.

[Download the Windows app](https://github.com/exKitsune/Umalytics/releases/latest) · [Open the web viewer](https://exkitsune.github.io/Umalytics/)

## First-time setup

1. Download **Umalytics.exe** from the [latest release](https://github.com/exKitsune/Umalytics/releases/latest).
2. Put it in its own folder, such as `Documents\Umalytics`, then open it. The app creates its files there.
3. Open **Settings → Capture certificate → Install certificate**. Approve the Windows prompt once.
4. Under **Steam setup**, click **Copy launch option**.
5. In Steam, right-click the game → **Properties → General → Launch Options**. Paste the copied line.
6. Launch the game from Steam. Look for **Game connected** in Umalytics, then play or open a replay. Captured races appear in the sidebar.

Closing the window keeps collection running in the tray. Use **Exit** in the tray menu to stop it. Keep the app folder private: it holds your races and capture certificate key.

The app checks for updates hourly. **Update and restart** installs the latest app and data after the game closes.

## Use the web viewer instead

Already have JSON files from horseACT or another collector? Open the [web viewer](https://exkitsune.github.io/Umalytics/) and import them. No app installation, certificate or Steam changes are needed. Files are processed in your browser.

## Notices

Third-party code, data and artwork retain their copyrights and licenses. See the [code notice](src/data/THIRD_PARTY_LICENSE.txt), [data notice](public/data/NOTICE.txt), [portrait notice](public/portraits/NOTICE.txt) and [icon notice](public/icons/NOTICE.txt).
