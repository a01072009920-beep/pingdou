# MARD palette source

Data: https://github.com/makebead/craft-color-codes/blob/85beca536d40b1a6254dc130d7d5923d96db9f7b/data/csv/mard-291.csv

Copyright (c) 2026 MakeBead (https://makebead.com). The upstream MIT license is included in LICENSE. Retrieved 2026-10-21. The original 291-row CSV is preserved alongside this notice; src/mard-palette.json contains its code, name, hex and derived series fields. No network request is needed at runtime.

Local adjustments requested by the user (applied in src/palette.mjs):

| Code | Source HEX | Local HEX |
| --- | --- | --- |
| B7 | #3DAF80 | #3EAE7C |
| D5 | #B843C5 | #B34EC6 |
| H1 | #FDFBFF | #FFFFFF |
| H4 | #89858C | #868686 |

Display order: A, B, C, D, E, F, G, H, M, P, T, R, Y, Q, ZG, then ascending numeric code within each series. Codes are not reassigned to force a lightness gradient. Special-effect colors use the source's flat screen reference; PNG exports use those same RGB values.

The old 24-color palette remains internal for rendering and exporting existing artwork with exact original colors. It is not part of the 291 selectable MARD colors. Loading a legacy room upgrades only its in-memory representation; disk changes occur on the next user edit through the normal atomic save path. Room keys, cell revisions and global revision remain unchanged by conversion.
