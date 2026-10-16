# UI icons

The app bundles 89 icons: skill types, stats, English mood labels, aptitudes,
weather, and English seasons. The skill icon IDs come from the game master
reference. UI assets come from the pinned Kachi Umalator checkout listed in
`public/icons/source.json`.

```powershell
node scripts/build-ui-icons.mjs --source path/to/uma-tools
```

The builder verifies every source file against its pinned Git blob, then stores
the unchanged PNG bytes as data URLs in `src/data/ui-icons.json`. The app works
offline and does not request these images from another site. Vite builds the
images into a separate asset chunk. `public/icons/NOTICE.txt` records attribution.

Strategy badges are drawn by Umalytics. Front and Runaway have separate labels
and colors. A recorded Front runner with an applicable guaranteed Runaway skill
is displayed as Runaway without changing the captured strategy field.

Uma portraits follow the separate source process in [portrait provenance](portrait-provenance.md);
this icon builder does not generate portraits or modify game files.
