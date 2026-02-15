# WME Polygon Snap

**WME Polygon Snap** is a Tampermonkey userscript for the Waze Map Editor (WME) that adds precision cursor snapping to nearby polygon lines and vertices. It helps editors align new and existing polygons perfectly with other map features.

## Features
- **Smart Snapping**: Snaps to both vertices (corners) and edges (lines).
- **Multi-Layer Support**: Works across Places, Map Comments, MTEs, RDAs, and more.
- **Toggle Control**: Quick-access floating button to enable/disable snapping on the fly.
- **Native Integration**: Uses WME's internal OpenLayers engine for smooth performance.

## Installation
1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension.
2. [Click here to install the script](wme-polygon-snap.user.js) (or copy-paste the code into a new script).
3. Refresh WME, and look for the 🧲 icon in the bottom right.

## Configuration
You can customize the script behavior by editing the values in the `USER CONFIGURATION` section at the top of the script:

| Setting | Default | Description |
| :--- | :--- | :--- |
| `SNAP_TOLERANCE` | `12` | Distance in pixels before the cursor "jumps" to a point. |
| `POLL_INTERVAL` | `250` | Responsiveness of state detection (ms). |
| `ENABLED_BY_DEFAULT` | `true` | Whether snapping starts ON when WME loads. |
| `SNAP_TO_EDGES` | `true` | Enable/disable snapping to the lines between vertices. |
| `SNAP_TO_VERTICES` | `true` | Enable/disable snapping to corner points. |
| `SNAP_LAYERS` | (Various) | Toggle which layers (Venues, Comments, etc.) are snappable. |

## License
MIT
