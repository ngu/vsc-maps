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

type TileSourceModel =
  | { type: "osm" }
  | { type: "xyz"; url: string; attributions?: string | string[] }
  | {
      type: "wms";
      url: string;
      layers: string;
      tiled?: boolean;
      format?: string;
      attributions?: string | string[];
    };

type VectorSourceModel =
  | { type: "geojson"; url: string }
  | { type: "topojson"; url: string }
  | { type: "kml"; url: string }
  | { type: "gml"; url: string };

type TileLayerModel = {
  type: "tile";
  opacity?: number;
  visible?: boolean;
  source: TileSourceModel;
};

type VectorLayerModel = {
  type: "vector";
  opacity?: number;
  visible?: boolean;
  source: VectorSourceModel;
};

type LayerModel = TileLayerModel | VectorLayerModel;

type ProjectionDefinition = {
  code: string;
  def: string;
  extent?: [number, number, number, number];
};

type OLMapModel = {
  projections?: ProjectionDefinition[];
  view: {
    center: [number, number];
    zoom: number;
    projection?: string;
  };
  layers: LayerModel[];
};

type ReplaceEdit = {
  editType: "replace";
  path: string;
  value: unknown;
};

type ViewSyncState = {
  center: [number, number];
  zoom: number;
};

type OlViewLike = {
  getCenter: () => unknown;
  getZoom: () => unknown;
  setCenter: (center: [number, number]) => void;
  setZoom: (zoom: number) => void;
  on: (eventName: string, handler: () => void) => void;
};

type OlMapLike = {
  setTarget: (target?: Element) => void;
  getView: () => unknown;
};

type WebviewIncomingMessage =
  | {
      type: "parseError";
      error?: string;
    }
  | {
      type: "updateModel";
      model: OLMapModel;
    }
  | {
      type: "operationResult";
      ok: boolean;
      message: string;
    };

type WebviewOutgoingMessage = {
  type: "edit";
  payload: ReplaceEdit | ReplaceEdit[];
};

type VsCodeApi = {
  postMessage(message: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

declare global {
  interface Window {
    __olMapsVscode?: VsCodeApi;
    __olMapsInitialPayload?: WebviewIncomingMessage;
    acquireVsCodeApi: () => VsCodeApi;
  }
}

let mapInstance: OlMapLike | undefined;
let mapStructureSignature: string | undefined;
const vscode = window.__olMapsVscode ?? window.acquireVsCodeApi();
const VIEW_SYNC_DELAY_MS = 350;
const VIEW_SYNC_EPSILON = 1e-9;

let viewSyncTimeout: number | undefined;
let lastCommittedViewState: ViewSyncState | undefined;

const mapElement = document.getElementById("map");
const initialPayload = window.__olMapsInitialPayload;

if (initialPayload) {
  handleMessage(initialPayload);
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (isIncomingMessage(event.data)) {
    handleMessage(event.data);
  }
});

function handleMessage(message: WebviewIncomingMessage): void {
  if (message.type === "parseError") {
    showError(message.error ?? "Unable to parse YOL model.");
    return;
  }

  if (message.type === "updateModel") {
    try {
      renderMap(message.model);
      showOk("Model synced");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown render error";
      showError(text);
    }
  }
}

function isIncomingMessage(value: unknown): value is WebviewIncomingMessage {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }

  const message = value as { type: unknown };
  return (
    message.type === "parseError" ||
    message.type === "updateModel" ||
    message.type === "operationResult"
  );
}

function renderMap(model: OLMapModel): void {
  if (!mapElement) {
    throw new Error("Map container not found.");
  }

  const nextSignature = getMapStructureSignature(model);

  if (mapInstance && mapStructureSignature === nextSignature) {
    const existingView = mapInstance.getView() as OlViewLike;
    const currentCenter = existingView.getCenter();
    const currentZoom = existingView.getZoom();

    if (
      Array.isArray(currentCenter) &&
      currentCenter.length === 2 &&
      typeof currentZoom === "number"
    ) {
      const currentView: ViewSyncState = {
        center: [currentCenter[0], currentCenter[1]],
        zoom: currentZoom
      };
      const nextView: ViewSyncState = {
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

  mapInstance = nextMap as OlMapLike;
  mapStructureSignature = nextSignature;

  const view = nextMap.getView() as OlViewLike;
  const scheduleViewSync = (): void => {
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

function syncViewToBackend(view: {
  getCenter: () => unknown;
  getZoom: () => unknown;
}): void {
  const center = view.getCenter();
  const zoom = view.getZoom();

  if (!Array.isArray(center) || center.length !== 2 || typeof zoom !== "number") {
    return;
  }

  const nextState: ViewSyncState = {
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

function isSameViewState(a: ViewSyncState | undefined, b: ViewSyncState): boolean {
  if (!a) {
    return false;
  }

  return (
    Math.abs(a.center[0] - b.center[0]) < VIEW_SYNC_EPSILON &&
    Math.abs(a.center[1] - b.center[1]) < VIEW_SYNC_EPSILON &&
    Math.abs(a.zoom - b.zoom) < VIEW_SYNC_EPSILON
  );
}

function sendEditPayload(payload: ReplaceEdit | ReplaceEdit[]): void {
  const message: WebviewOutgoingMessage = {
    type: "edit",
    payload
  };
  vscode.postMessage(message);
}

function registerProjections(projections: ProjectionDefinition[]): void {
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

function createLayer(layer: LayerModel) {
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
    throw new Error(`Unsupported layer type: ${String((layer as LayerModel).type)}`);
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

function createVectorSource(source: VectorSourceModel) {
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

  throw new Error(`Unsupported vector source type: ${String((source as VectorSourceModel).type)}`);
}

function createTileSource(source: TileSourceModel) {
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

function defaultOsmLayer(): LayerModel {
  return {
    type: "tile",
    source: {
      type: "osm"
    }
  };
}

function showError(_message: string): void {
  // No-op for now; parse/render failures remain visible via map non-render and extension logs.
}

function showOk(_message: string): void {
  // No-op for now; status UI was removed.
}

function getMapStructureSignature(model: OLMapModel): string {
  return JSON.stringify({
    projections: model.projections ?? [],
    projection: model.view.projection ?? "EPSG:3857",
    layers: model.layers
  });
}

export {};
