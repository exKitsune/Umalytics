# Portrait provenance and local generation

The 130 bundled `public/portraits/chr_icon_*.png` files were copied unchanged from
the cached **kachi-dev/uma-tools** Umalator fork at revision
`4401e25987d9c78707f2d3f8a9dcd02c1c56529c`. Every file matches its committed Git
blob. This is their exact PNG-byte provenance; the initial attribution to
TheCing's fork was corrected. No GameTora image download supplied these files.

The viewer also bundles 224 trained outfit portraits from the same pinned revision.
`src/data/outfit-portraits.json` preserves its explicit `icons.json` card mapping;
card IDs are not guessed from costume filenames. For example, Special Week's
Commander card 100103 uses `trained_chr_icon_1001_100102_02.png`, while Summer
card 100102 uses costume 100130. Card art takes precedence over the generic
character head; unavailable mappings fall back to that head or an initial.
`public/portraits/outfit-source.json` records each PNG's upstream Git blob,
SHA-256 and byte count, and the mapping's upstream blob. All 224 copied files
were checked against their committed upstream blobs.

Independent decode of the installed Commander bundle
`chara/chr1001/trained_chr_icon_1001_100102_02` matches its bundled portrait's
256 × 256 RGBA pixels exactly, including alpha. Bundle SHA-256:
`585032dfaf83acee0c3992a565a84fb72833bd6b0f166b4822c5dcc73954ab91`.

The upstream [portrait generator](https://github.com/kachi-dev/uma-tools/blob/4401e25987d9c78707f2d3f8a9dcd02c1c56529c/make_uma_info.pl)
queries the game's asset catalog for `chr_icon_<id>` and copies the corresponding
`dat/<hash-prefix>/<hash>` bundle for unpacking. Its separate
`move_unpacked_resources.pl` moves unpacked PNGs into the icon directory.
These scripts establish an extraction path; they do not prove the complete
historical production chain of every committed PNG.

An independent installed Global asset check found
`chara/chr1001/chr_icon_1001`, containing a 256 × 256 `Texture2D` named
`chr_icon_1001`. Its encrypted bundle SHA-256 is
`2eda8d912a0fd97f1d82cf6275c500fa8ca46eb765d5248ca616e8f3808e183b`.
The bundled upstream PNG SHA-256 is
`0eb7253da4de341e11b287a1ea04ff26c7f0f2b460ba5f6db7fcb42d5a72ab37`.
The independent decode differs from that PNG in **one of 65,536 RGBA pixels**.
It strongly corroborates common game-art origin, while ruling out a claim of
exact identity to the current installed texture.

## Generate PNGs independently

`scripts/extract-portraits.py` reads a supplied cache containing `meta` and `dat`.
It reuses the course extractor's catalog/decrypt helpers and pinned dependencies
from `scripts/requirements-geometry.txt`. No game process or network request is
used, and output must be separate from both cache and comparison inputs:

```powershell
python scripts/extract-portraits.py --cache <game-cache> --output <separate-output> --compare public/portraits
python tests/portrait-system.py --cache <game-cache>
python scripts/extract-portraits.py --cache <game-cache> --output <separate-outfit-output> --outfit-map src/data/outfit-portraits.json --card-ids 100103
```

Optional `--character-ids 1001 1002` selects specific characters. Outfit extraction
requires an explicit card-to-filename map and can filter by `--card-ids`; it does
not assume card ID equals costume ID or derive ordering from the catalog.
Existing output
files require explicit `--overwrite`. Missing bundles are reported without
downloading them; placeholder character zero is excluded.

Exact-named standalone textures retain their full decoded dimensions and native
alpha, with no added background or guessed crop. The Sprite branch delegates
atlas rectangle, packing rotation, split alpha and tight-mesh masking to pinned
UnityPy `SpriteHelper`; unresolved dependencies are reported as unsupported,
rather than exporting a whole atlas as a portrait. The inspected generic icon
set exercised standalone textures, not that Sprite branch.

The installed cache generated **107 of 107 selected generic character portraits** with
no unsupported or missing bundles. Of 93 also present in the upstream PNG set,
42 had exactly equal decoded RGBA pixels; the others differed, so versions must
not be silently mixed. The whole-process test runs the real CLI twice, checks
deterministic PNG output and retained alpha, verifies the known one-pixel origin
anchor, confirms unchanged inputs, and exercises output-directory rejection.
It also regenerates Commander twice and checks deterministic PNG bytes and exact
RGBA equality to its outfit reference.

Artwork retains its original copyright; see the bundled portrait notice. The upstream repository declares GPLv3 for software;
that declaration is not represented as a separate grant for game artwork.
Independent extraction changes where PNGs are generated, not their artwork
ownership. Runtime portraits are served locally, without external image requests.
