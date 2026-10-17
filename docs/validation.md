# Validation

Only end-to-end and system tests are kept.

## Automated workflows

- `npm test`: starts the importer and HTTP server as separate processes. Imports a race, reads it from the running library, exports and reimports it, and checks that telemetry survives. A second workflow checks failed imports, partial files, and access to unrelated files.
- `python desktop/smoke_packaged.py <collector-exe> --collector-probe`: runs the packaged collector in an isolated folder. Checks startup, saved races, settings, restart, proxy routing, and bundled data. See the script's options for repository updates.
- `python tests/launcher/test_launcher.py`: runs the Windows launcher with a harmless stand-in. Checks arguments, proxy settings, exit status, and console behavior. Requires the standalone launcher build, Steam running, and a free proxy port.
- `npm run build`: checks Svelte/TypeScript and builds the website.

Tests never install a certificate or launch the real game.

## Browser checks

Checked the Svelte UI with a previously captured Room Match:

- JSON import and library persistence after reload.
- Nine runners, 113 frames, and 71 events in the exported JSON.
- Runner names, stats, skill names, and skill activation markers.
- Playback, pause, and seeking to a skill activation.
- Download Uma JSON and clear reporting of fields missing for Umalator.
- Dark and light themes, settings, and the layout at 1440 × 1000.
- Tokyo 2400 m demo at the start, back straight, and finish: a closed oval, distinct start/finish positions, and all runners aligned with the finish line at 2400 m.

The hosted Pages viewer imported a synthetic race and loaded its course and skill data. The packaged frontend picked up a new race from its local service without a reload; collection settings survived a reload.

A synthetic complete build was imported into Umalator through its clipboard action. Tokyo 2400 m course segments and slopes were checked against GameTora. These checks do not establish exact track geometry.

## Live capture

The regular proxy previously captured and decoded a real saved Room Match on Steam Global. See [the capture record](proxy-live-validation.md). Career, Team Trials, and Champions Meeting still need live checks with the packaged app. Sleep/resume over multiple days has not been tested.
