import Map from "https://esm.sh/ol@9.2.4/Map";
import View from "https://esm.sh/ol@9.2.4/View";
import TileLayer from "https://esm.sh/ol@9.2.4/layer/Tile";
import VectorLayer from "https://esm.sh/ol@9.2.4/layer/Vector";
import OSM from "https://esm.sh/ol@9.2.4/source/OSM";
import XYZ from "https://esm.sh/ol@9.2.4/source/XYZ";
import TileWMS from "https://esm.sh/ol@9.2.4/source/TileWMS";
import VectorSource from "https://esm.sh/ol@9.2.4/source/Vector";
import GeoJSON from "https://esm.sh/ol@9.2.4/format/GeoJSON";
import TopoJSON from "https://esm.sh/ol@9.2.4/format/TopoJSON";
import KML from "https://esm.sh/ol@9.2.4/format/KML";
import GML3 from "https://esm.sh/ol@9.2.4/format/GML3";
import { register } from "https://esm.sh/ol@9.2.4/proj/proj4";
import { addProjection, get as getProjection } from "https://esm.sh/ol@9.2.4/proj";
import Projection from "https://esm.sh/ol@9.2.4/proj/Projection";
import { defaults as defaultInteractions } from "https://esm.sh/ol@9.2.4/interaction/defaults";
import proj4 from "https://esm.sh/proj4@2.12.1";
let mapInstance;
let mapStructureSignature;
const vscode = window.__olMapsVscode ?? window.acquireVsCodeApi();
const VIEW_SYNC_DELAY_MS = 350;
const VIEW_SYNC_EPSILON = 1e-9;
let viewSyncTimeout;
let lastCommittedViewState;
const mapElement = document.getElementById("map");
const initialPayload = window.__olMapsInitialPayload;
if (initialPayload) {
    handleMessage(initialPayload);
}
window.addEventListener("message", (event) => {
    if (isIncomingMessage(event.data)) {
        handleMessage(event.data);
    }
});
function handleMessage(message) {
    if (message.type === "parseError") {
        showError(message.error ?? "Unable to parse YOL model.");
        return;
    }
    if (message.type === "updateModel") {
        try {
            renderMap(message.model);
            showOk("Model synced");
        }
        catch (error) {
            const text = error instanceof Error ? error.message : "Unknown render error";
            showError(text);
        }
    }
}
function isIncomingMessage(value) {
    if (!value || typeof value !== "object" || !("type" in value)) {
        return false;
    }
    const message = value;
    return (message.type === "parseError" ||
        message.type === "updateModel" ||
        message.type === "operationResult");
}
function renderMap(model) {
    if (!mapElement) {
        throw new Error("Map container not found.");
    }
    const nextSignature = getMapStructureSignature(model);
    if (mapInstance && mapStructureSignature === nextSignature) {
        const existingView = mapInstance.getView();
        const currentCenter = existingView.getCenter();
        const currentZoom = existingView.getZoom();
        if (Array.isArray(currentCenter) &&
            currentCenter.length === 2 &&
            typeof currentZoom === "number") {
            const currentView = {
                center: [currentCenter[0], currentCenter[1]],
                zoom: currentZoom
            };
            const nextView = {
                center: [model.view.center[0], model.view.center[1]],
                zoom: model.view.zoom
            };
            if (!isSameViewState(currentView, nextView)) {
                existingView.setCenter(nextView.center);
                existingView.setZoom(nextView.zoom);
            }
            lastCommittedViewState = nextView;
            return;
        }
    }
    if (mapInstance) {
        mapInstance.setTarget(undefined);
        mapInstance = undefined;
    }
    if (viewSyncTimeout !== undefined) {
        window.clearTimeout(viewSyncTimeout);
        viewSyncTimeout = undefined;
    }
    if (Array.isArray(model.projections)) {
        registerProjections(model.projections);
    }
    lastCommittedViewState = {
        center: [model.view.center[0], model.view.center[1]],
        zoom: model.view.zoom
    };
    const nextMap = new Map({
        target: mapElement,
        controls: [],
        interactions: defaultInteractions({
            onFocusOnly: false
        }),
        view: new View({
            center: model.view.center,
            zoom: model.view.zoom,
            projection: model.view.projection || "EPSG:3857"
        }),
        layers: model.layers.length > 0 ? model.layers.map(createLayer) : [createLayer(defaultOsmLayer())]
    });
    mapInstance = nextMap;
    mapStructureSignature = nextSignature;
    const view = nextMap.getView();
    const scheduleViewSync = () => {
        if (viewSyncTimeout !== undefined) {
            window.clearTimeout(viewSyncTimeout);
        }
        viewSyncTimeout = window.setTimeout(() => {
            viewSyncTimeout = undefined;
            syncViewToBackend(view);
        }, VIEW_SYNC_DELAY_MS);
    };
    view.on("change:center", scheduleViewSync);
    view.on("change:resolution", scheduleViewSync);
}
function syncViewToBackend(view) {
    const center = view.getCenter();
    const zoom = view.getZoom();
    if (!Array.isArray(center) || center.length !== 2 || typeof zoom !== "number") {
        return;
    }
    const nextState = {
        center: [center[0], center[1]],
        zoom
    };
    if (isSameViewState(lastCommittedViewState, nextState)) {
        return;
    }
    lastCommittedViewState = {
        center: [nextState.center[0], nextState.center[1]],
        zoom: nextState.zoom
    };
    sendEditPayload([
        {
            editType: "replace",
            path: "view.center",
            value: nextState.center
        },
        {
            editType: "replace",
            path: "view.zoom",
            value: nextState.zoom
        }
    ]);
}
function isSameViewState(a, b) {
    if (!a) {
        return false;
    }
    return (Math.abs(a.center[0] - b.center[0]) < VIEW_SYNC_EPSILON &&
        Math.abs(a.center[1] - b.center[1]) < VIEW_SYNC_EPSILON &&
        Math.abs(a.zoom - b.zoom) < VIEW_SYNC_EPSILON);
}
function sendEditPayload(payload) {
    const message = {
        type: "edit",
        payload
    };
    vscode.postMessage(message);
}
function registerProjections(projections) {
    for (const projDef of projections) {
        proj4.defs(projDef.code, projDef.def);
        if (!getProjection(projDef.code)) {
            const projection = new Projection({ code: projDef.code });
            if (projDef.extent) {
                projection.setExtent(projDef.extent);
            }
            addProjection(projection);
        }
    }
    register(proj4);
}
function createLayer(layer) {
    if (layer.type === "vector") {
        const source = createVectorSource(layer.source);
        const vectorLayer = new VectorLayer({ source });
        if (typeof layer.opacity === "number") {
            vectorLayer.setOpacity(layer.opacity);
        }
        if (typeof layer.visible === "boolean") {
            vectorLayer.setVisible(layer.visible);
        }
        return vectorLayer;
    }
    if (layer.type !== "tile") {
        throw new Error(`Unsupported layer type: ${String(layer.type)}`);
    }
    const source = createTileSource(layer.source);
    const tileLayer = new TileLayer({ source });
    if (typeof layer.opacity === "number") {
        tileLayer.setOpacity(layer.opacity);
    }
    if (typeof layer.visible === "boolean") {
        tileLayer.setVisible(layer.visible);
    }
    return tileLayer;
}
function createVectorSource(source) {
    if (source.type === "geojson") {
        return new VectorSource({ url: source.url, format: new GeoJSON() });
    }
    if (source.type === "topojson") {
        return new VectorSource({ url: source.url, format: new TopoJSON() });
    }
    if (source.type === "kml") {
        return new VectorSource({ url: source.url, format: new KML() });
    }
    if (source.type === "gml") {
        return new VectorSource({ url: source.url, format: new GML3() });
    }
    throw new Error(`Unsupported vector source type: ${String(source.type)}`);
}
function createTileSource(source) {
    if (source.type === "osm") {
        return new OSM();
    }
    if (source.type === "xyz") {
        return new XYZ({
            url: source.url,
            attributions: source.attributions
        });
    }
    if (source.type === "wms") {
        return new TileWMS({
            url: source.url,
            attributions: source.attributions,
            params: {
                LAYERS: source.layers,
                TILED: source.tiled ?? true,
                ...(source.format ? { FORMAT: source.format } : {})
            }
        });
    }
    throw new Error(`Unsupported tile source type: ${String(source)}`);
}
function defaultOsmLayer() {
    return {
        type: "tile",
        source: {
            type: "osm"
        }
    };
}
function showError(_message) {
    // No-op for now; parse/render failures remain visible via map non-render and extension logs.
}
function showOk(_message) {
    // No-op for now; status UI was removed.
}
function getMapStructureSignature(model) {
    return JSON.stringify({
        projections: model.projections ?? [],
        projection: model.view.projection ?? "EPSG:3857",
        layers: model.layers
    });
}
//# sourceMappingURL=app.js.map