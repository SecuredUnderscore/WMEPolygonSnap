// ==UserScript==
// @name         WME Polygon Snap
// @namespace    https://greasyfork.org/users/wme-polygon-snap
// @version      1.0.0
// @description  Snap to nearby polygon edges and vertices when drawing or modifying polygons in the Waze Map Editor.
// @author       ThatVictoriaGuy (Secured_ on Discord)
// @license      MIT
// @match        https://www.waze.com/editor*
// @match        https://www.waze.com/*/editor*
// @match        https://beta.waze.com/editor*
// @match        https://beta.waze.com/*/editor*
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='80' font-size='80'%3E🧲%3C/text%3E%3C/svg%3E
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* jshint esversion: 11 */

(function () {
    'use strict';

    // ╔════════════════════════════════════════════════════════════════════╗
    // ║                     USER CONFIGURATION                           ║
    // ║  Adjust these values to customize snapping behavior.             ║
    // ╚════════════════════════════════════════════════════════════════════╝

    /** Snap tolerance in pixels. Higher = snaps from farther away.
     *  Recommended range: 8–20. Default: 12 */
    const SNAP_TOLERANCE = 12;

    /** How often (ms) to check for drawing/editing state changes.
     *  Lower = more responsive, higher = less CPU usage.
     *  Recommended range: 100–500. Default: 250 */
    const POLL_INTERVAL = 250;

    /** Start with snapping enabled? Set to false to start disabled. */
    const ENABLED_BY_DEFAULT = true;

    /** Snap to polygon edges (the lines between vertices)? */
    const SNAP_TO_EDGES = true;

    /** Snap to polygon vertices (corner points)? */
    const SNAP_TO_VERTICES = true;

    /** Snap to polygon nodes? (Usually the same as vertices for polygons.) */
    const SNAP_TO_NODES = true;

    /** Which layers to snap to. Set any to false to exclude that layer.
     *  Only affects layers that exist on the current map view. */
    const SNAP_LAYERS = {
        venues: true,   // Places / landmarks
        mapComments: true,   // Map comments (polygon type)
        majorTrafficEvents: true,   // MTEs
        restrictedDrivingAreas: true,   // Restricted driving areas
        permanentHazards: true,   // Permanent hazards (polygon type)
        bigJunctions: true,   // Big junctions
    };

    // ╔════════════════════════════════════════════════════════════════════╗
    // ║                  END OF USER CONFIGURATION                       ║
    // ║  Do not modify below this line unless you know what you're doing ║
    // ╚════════════════════════════════════════════════════════════════════╝

    const SCRIPT_NAME = 'WME Polygon Snap';
    const SCRIPT_VERSION = '1.0.0';

    // ─── Internal State ──────────────────────────────────────────────────
    let enabled = ENABLED_BY_DEFAULT;
    let drawSnappingControl = null;
    let modifySnappingControl = null;
    let currentModifyLayerName = null;
    let pollingTimer = null;
    let W = null;
    let OL = null;

    // ─── Logging ─────────────────────────────────────────────────────────
    const log = (...a) => console.log(`[${SCRIPT_NAME}]`, ...a);
    const warn = (...a) => console.warn(`[${SCRIPT_NAME}]`, ...a);

    // ─── Bootstrap ───────────────────────────────────────────────────────
    function bootstrap() {
        const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        W = win.W;
        OL = win.OpenLayers;

        const ready =
            W?.map?.getWazeMap?.() &&
            W.model &&
            W.editingMediator &&
            W.selectionManager &&
            OL?.Control?.Snapping &&
            document.querySelector('#WazeMap');

        if (ready) {
            log(`v${SCRIPT_VERSION} — WME loaded, initializing`);
            init();
        } else {
            setTimeout(bootstrap, 800);
        }
    }

    // ─── OpenLayers Map Access ───────────────────────────────────────────
    function getOLMap() {
        try { return W.map.getWazeMap().getOLMap(); } catch (_) { }
        try { return W.map.getWazeMap().olMap; } catch (_) { }
        try { return W.map.wazeMap?.olMap; } catch (_) { }
        return null;
    }

    // ─── Layer Utilities ─────────────────────────────────────────────────
    // WME wraps OL layers in WazeFeatureMapper objects. The raw OL layer
    // lives at wrapper.layer. We need the raw layer for snapping.

    function getRawOLLayer(obj) {
        if (!obj) return null;
        if (obj.CLASS_NAME) return obj;              // already raw
        if (obj.layer?.CLASS_NAME) return obj.layer;  // unwrap mapper
        return null;
    }

    function getSketchLayer() {
        try {
            const sl = W.map.getSketchLayer?.() || W.map.sketchLayer;
            return getRawOLLayer(sl) || sl;
        } catch (_) { return null; }
    }

    /**
     * Collect all OL vector layers that should act as snap targets,
     * filtered by the user's SNAP_LAYERS configuration.
     */
    function getSnapTargetLayers() {
        const targets = [];
        const sketchName = getSketchLayer()?.name;

        // Map config keys → WMEMap property names
        const layerMap = [
            ['venues', 'venueLayer'],
            ['mapComments', 'commentLayer'],
            ['majorTrafficEvents', 'mteLayer'],
            ['restrictedDrivingAreas', 'restrictedDrivingAreaLayer'],
            ['permanentHazards', 'permanentHazardLayer'],
            ['bigJunctions', 'bigJunctionLayer'],
        ];

        for (const [configKey, prop] of layerMap) {
            if (!SNAP_LAYERS[configKey]) continue;  // user disabled this layer
            const raw = getRawOLLayer(W.map[prop]);
            if (raw && raw.name !== sketchName && raw.features) {
                targets.push(raw);
            }
        }

        // Fallback: if no named layers found, scan all vector layers
        if (targets.length === 0) {
            const olMap = getOLMap();
            if (!olMap) return [];
            for (const layer of olMap.layers) {
                if (
                    layer.CLASS_NAME === 'OpenLayers.Layer.Vector' &&
                    layer.features &&
                    layer.visibility &&
                    !layer.isBaseLayer &&
                    layer.name !== sketchName
                ) {
                    targets.push(layer);
                }
            }
            if (targets.length) {
                log('Using fallback layer scan — found', targets.length, 'vector layers');
            }
        }

        return targets;
    }

    // ─── Snapping Control Factory ────────────────────────────────────────

    function createSnappingControl(editableLayer) {
        if (!OL?.Control?.Snapping) {
            warn('OpenLayers.Control.Snapping not available');
            return null;
        }

        const targetLayers = getSnapTargetLayers();
        if (!targetLayers.length) {
            warn('No target layers found for snapping');
            return null;
        }

        const targets = targetLayers.map(layer => ({
            layer,
            tolerance: SNAP_TOLERANCE,
            node: SNAP_TO_NODES,
            vertex: SNAP_TO_VERTICES,
            edge: SNAP_TO_EDGES,
        }));

        const ctrl = new OL.Control.Snapping({
            layer: editableLayer,
            targets,
            greedy: false,
        });

        // Vertex/node snapping takes priority over edge snapping.
        // When the cursor is near both a corner and an edge, it will
        // snap to the corner — which is the expected behavior.
        ctrl.precedence = ['node', 'vertex', 'edge'];

        return ctrl;
    }

    function activateControl(ctrl) {
        const olMap = getOLMap();
        if (!ctrl || !olMap) return;
        try {
            olMap.addControl(ctrl);
            ctrl.activate();
        } catch (e) { warn('Failed to activate snapping control:', e); }
    }

    function deactivateControl(ctrl) {
        if (!ctrl) return;
        const olMap = getOLMap();
        try { ctrl.deactivate(); } catch (_) { }
        try { olMap?.removeControl(ctrl); } catch (_) { }
        try { ctrl.destroy(); } catch (_) { }
    }

    // ─── Draw-Mode Snapping ──────────────────────────────────────────────
    // Attaches snapping to the sketch layer so the cursor snaps while
    // placing vertices during polygon drawing.

    function attachDrawSnapping() {
        if (!enabled || drawSnappingControl) return;
        const sketch = getSketchLayer();
        if (!sketch) return;

        drawSnappingControl = createSnappingControl(sketch);
        if (drawSnappingControl) {
            activateControl(drawSnappingControl);
            log('Draw snapping activated');
        }
    }

    function detachDrawSnapping() {
        if (!drawSnappingControl) return;
        deactivateControl(drawSnappingControl);
        drawSnappingControl = null;
        log('Draw snapping deactivated');
    }

    // ─── Modify-Mode Snapping ────────────────────────────────────────────
    // Attaches snapping to the selected feature's layer so dragged vertices
    // snap to edges/vertices of other polygons.

    function attachModifySnapping() {
        if (!enabled || modifySnappingControl) return;
        const layer = getSelectedPolygonLayer();
        if (!layer) return;

        modifySnappingControl = createSnappingControl(layer);
        if (modifySnappingControl) {
            activateControl(modifySnappingControl);
            currentModifyLayerName = layer.name;
            log('Modify snapping activated on', layer.name);
        }
    }

    function detachModifySnapping() {
        if (!modifySnappingControl) return;
        deactivateControl(modifySnappingControl);
        modifySnappingControl = null;
        currentModifyLayerName = null;
        log('Modify snapping deactivated');
    }

    // ─── Feature Detection ───────────────────────────────────────────────

    const POLYGON_FEATURE_TYPES = [
        'venue', 'mapComment', 'mte',
        'restrictedDrivingArea', 'permanentHazard', 'bigJunction',
    ];

    function isPolygonFeature(feature) {
        const type = feature.getType?.();
        if (type) return POLYGON_FEATURE_TYPES.includes(type);

        const geom = feature.getGeometry?.() || feature.geometry;
        if (geom) {
            const gt = (geom.type || geom.CLASS_NAME || '').toLowerCase();
            return gt.includes('polygon');
        }
        return false;
    }

    function getSelectedPolygonLayer() {
        try {
            const selected =
                W.selectionManager.getSelectedDataModelObjects?.() ||
                W.selectionManager.getSelectedFeatures?.();
            if (!selected?.length) return null;

            const feature = selected[0];
            if (!feature || !isPolygonFeature(feature)) return null;

            const layer = W.selectionManager.getLayerFromModel?.(feature);
            return getRawOLLayer(layer) || layer || null;
        } catch (_) { return null; }
    }

    // ─── Drawing Detection ───────────────────────────────────────────────

    function isDrawingActive() {
        try {
            if (W.editingMediator.isDrawing?.()) return true;

            const olMap = getOLMap();
            if (olMap?.controls) {
                for (const ctrl of olMap.controls) {
                    if (ctrl.active && ctrl.CLASS_NAME?.includes('DrawFeature')) {
                        return true;
                    }
                }
            }
        } catch (_) { }
        return false;
    }

    // ─── State Poll ──────────────────────────────────────────────────────

    function pollState() {
        if (!enabled) {
            detachDrawSnapping();
            detachModifySnapping();
            return;
        }

        // Drawing
        if (isDrawingActive()) {
            if (!drawSnappingControl) attachDrawSnapping();
        } else if (drawSnappingControl) {
            detachDrawSnapping();
        }

        // Modifying
        const polyLayer = getSelectedPolygonLayer();
        if (polyLayer) {
            if (!modifySnappingControl || currentModifyLayerName !== polyLayer.name) {
                detachModifySnapping();
                attachModifySnapping();
            }
        } else if (modifySnappingControl) {
            detachModifySnapping();
        }
    }

    // ─── Toggle Button ───────────────────────────────────────────────────

    function createToggleButton() {
        if (document.getElementById('wme-polygon-snap-toggle')) return;

        const btn = document.createElement('button');
        btn.id = 'wme-polygon-snap-toggle';
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '30px',
            right: '60px',
            zIndex: '10000',
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            border: '2px solid #4a90d9',
            background: '#4a90d9',
            color: '#fff',
            fontSize: '18px',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            opacity: '0.9',
            lineHeight: '1',
        });
        btn.textContent = '🧲';

        function refresh() {
            btn.style.background = enabled ? '#4a90d9' : '#fff';
            btn.style.borderColor = enabled ? '#3a7bc8' : '#ccc';
            btn.style.color = enabled ? '#fff' : '#999';
            btn.title = `Polygon Snap: ${enabled ? 'ON' : 'OFF'}`;
        }

        btn.addEventListener('click', () => {
            enabled = !enabled;
            refresh();
            if (!enabled) {
                detachDrawSnapping();
                detachModifySnapping();
            }
            log(enabled ? 'Enabled' : 'Disabled');
        });

        btn.addEventListener('mouseenter', () => {
            btn.style.opacity = '1';
            btn.style.transform = 'scale(1.1)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.opacity = '0.9';
            btn.style.transform = 'scale(1)';
        });

        refresh();
        document.body.appendChild(btn);
    }

    // ─── Initialization ──────────────────────────────────────────────────

    function init() {
        const olMap = getOLMap();
        if (!olMap) {
            warn('OpenLayers map not accessible — retrying in 2 s');
            setTimeout(init, 2000);
            return;
        }

        log('Map ready —', olMap.layers.length, 'layers');

        // State polling
        pollingTimer = setInterval(pollState, POLL_INTERVAL);

        // Event-driven updates for snappier response
        try {
            W.selectionManager.addEventListener?.('selectionchanged', () =>
                setTimeout(pollState, 80));
        } catch (_) { }

        try {
            W.editingMediator.on?.('change', () =>
                setTimeout(pollState, 80));
        } catch (_) { }

        createToggleButton();
        log('Ready ✓');
    }

    // ─── Entry Point ─────────────────────────────────────────────────────
    log('Waiting for WME…');
    bootstrap();

})();
