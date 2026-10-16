# Umalytics

A replay and telemetry viewer.

[Download the Windows app](https://github.com/exKitsune/Umalytics/releases/latest) · [Open the web viewer](https://exkitsune.github.io/Umalytics/)

## First-time setup

1. Download **Umalytics.exe** from the [latest release](https://github.com/exKitsune/Umalytics/releases/latest), then open it.
2. Open **Settings → Capture certificate → Install certificate**. Approve the Windows prompt once.
3. Under **Steam setup**, click **Copy launch option**.
4. In Steam, right-click the game → **Properties → General → Launch Options**. Paste the copied line.
5. Launch the game from Steam. Look for **Game connected** in Umalytics, then play or open a replay. Captured races appear in the sidebar.

App files are saved in `%LOCALAPPDATA%\Umalytics`. Keep that folder private: it holds your races and capture certificate key. Existing data beside the executable is moved there once and the old folder is removed after verification.

Closing the window keeps collection running in the tray. Use **Exit** in the tray menu to stop it.

The app checks for updates hourly. **Update and restart** installs the latest app and data after the game closes.

## Use the web viewer instead

Already have JSON files from horseACT or another collector? Open the [web viewer](https://exkitsune.github.io/Umalytics/) and import them. No app installation, certificate or Steam changes are needed. Files are processed in your browser.

## Notices

Third-party code, data and artwork retain their copyrights and licenses. See the [code notice](src/data/THIRD_PARTY_LICENSE.txt), [data notice](public/data/NOTICE.txt), [portrait notice](public/portraits/NOTICE.txt) and [icon notice](public/icons/NOTICE.txt).
