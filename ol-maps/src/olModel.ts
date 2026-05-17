export type TileSourceModel =
  | {
      type: "osm";
    }
  | {
      type: "xyz";
      url: string;
      attributions?: string | string[];
    }
  | {
      type: "wms";
      url: string;
      layers: string;
      tiled?: boolean;
      format?: string;
      attributions?: string | string[];
    };

export type VectorSourceModel =
  | { type: "geojson"; url: string }
  | { type: "topojson"; url: string }
  | { type: "kml"; url: string }
  | { type: "gml"; url: string };

export type TileLayerModel = {
  type: "tile";
  opacity?: number;
  visible?: boolean;
  source: TileSourceModel;
};

export type VectorLayerModel = {
  type: "vector";
  opacity?: number;
  visible?: boolean;
  source: VectorSourceModel;
};

export type LayerModel = TileLayerModel | VectorLayerModel;

/**
 * A custom projection to register with proj4 before the map is created.
 * `code`  - the CRS authority string, e.g. "EPSG:27700".
 * `def`   - the proj4 definition string for that CRS.
 * `extent` - optional validity extent in the projection's units [minX, minY, maxX, maxY].
 */
export type ProjectionDefinition = {
  code: string;
  def: string;
  extent?: [number, number, number, number];
};

export type OLMapModel = {
  projections?: ProjectionDefinition[];
  view: {
    center: [number, number];
    zoom: number;
    projection?: string;
  };
  layers: LayerModel[];
};

export type WebviewPayload =
  | {
      type: "updateModel";
      model: OLMapModel;
      rawText: string;
    }
  | {
      type: "parseError";
      error: string;
      rawText: string;
    }
  | {
      type: "operationResult";
      ok: boolean;
      message: string;
    };

export type ReplaceEdit = {
  editType: "replace";
  path: string;
  value: unknown;
};

export type WebviewEdit = ReplaceEdit;

export type WebviewInboundMessage = {
  type: "edit";
  payload: WebviewEdit | WebviewEdit[];
};

export function toOLModel(parsed: unknown): OLMapModel {
  if (!isRecord(parsed)) {
    throw new Error("Root YAML node must be a mapping/object.");
  }

  const viewNode = parsed.view;
  const layersNode = parsed.layers;

  if (!isRecord(viewNode)) {
    throw new Error("`view` is required and must be an object.");
  }

  const centerNode = viewNode.center;
  const zoomNode = viewNode.zoom;

  if (!Array.isArray(centerNode) || centerNode.length !== 2) {
    throw new Error("`view.center` must be an array with two numbers.");
  }

  const centerX = Number(centerNode[0]);
  const centerY = Number(centerNode[1]);
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
    throw new Error("`view.center` values must be numeric.");
  }

  const zoom = Number(zoomNode);
  if (!Number.isFinite(zoom)) {
    throw new Error("`view.zoom` must be numeric.");
  }

  if (!Array.isArray(layersNode)) {
    throw new Error("`layers` is required and must be an array.");
  }

  const layers: LayerModel[] = layersNode.map((layerNode, index) => {
    if (!isRecord(layerNode)) {
      throw new Error(`Layer at index ${index} must be an object.`);
    }

    const layerType = layerNode.type;
    if (layerType !== "tile" && layerType !== "vector") {
      throw new Error(`Layer at index ${index} has unsupported type: ${String(layerType)}.`);
    }

    const sourceNode = layerNode.source;
    if (!isRecord(sourceNode) || typeof sourceNode.type !== "string") {
      throw new Error(`Layer at index ${index} has invalid source definition.`);
    }

    let parsedLayer: LayerModel;

    if (layerType === "tile") {
      const source = parseTileSource(sourceNode, index);
      parsedLayer = { type: "tile", source };
    } else {
      const source = parseVectorSource(sourceNode, index);
      parsedLayer = { type: "vector", source };
    }

    if (layerNode.opacity !== undefined) {
      const opacity = Number(layerNode.opacity);
      if (!Number.isFinite(opacity)) {
        throw new Error(`Layer at index ${index} has non-numeric opacity.`);
      }
      parsedLayer.opacity = opacity;
    }

    if (layerNode.visible !== undefined) {
      parsedLayer.visible = Boolean(layerNode.visible);
    }

    return parsedLayer;
  });

  const view: OLMapModel["view"] = {
    center: [centerX, centerY],
    zoom
  };

  if (typeof viewNode.projection === "string" && viewNode.projection.trim().length > 0) {
    view.projection = viewNode.projection;
  }

  const model: OLMapModel = { view, layers };

  if (Array.isArray(parsed.projections)) {
    model.projections = parsed.projections.map(parseProjectionDefinition);
  }

  return model;
}

function parseProjectionDefinition(node: unknown, index: number): ProjectionDefinition {
  if (!isRecord(node)) {
    throw new Error(`projections[${index}] must be an object.`);
  }

  const { code, def, extent } = node;

  if (typeof code !== "string" || code.trim().length === 0) {
    throw new Error(`projections[${index}].code must be a non-empty string.`);
  }

  if (typeof def !== "string" || def.trim().length === 0) {
    throw new Error(`projections[${index}].def must be a non-empty proj4 definition string.`);
  }

  const projection: ProjectionDefinition = { code, def };

  if (extent !== undefined) {
    if (!Array.isArray(extent) || extent.length !== 4 || !extent.every((v) => typeof v === "number")) {
      throw new Error(`projections[${index}].extent must be an array of four numbers.`);
    }
    projection.extent = extent as [number, number, number, number];
  }

  return projection;
}

function parseTileSource(sourceNode: Record<string, unknown>, layerIndex: number): TileSourceModel {
  if (sourceNode.type === "osm") {
    return { type: "osm" };
  }

  if (sourceNode.type === "xyz") {
    const url = sourceNode.url;
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error(`Layer at index ${layerIndex} uses xyz source but is missing a valid url.`);
    }

    const source: TileSourceModel = {
      type: "xyz",
      url
    };

    const attributions = sourceNode.attributions;
    if (
      typeof attributions === "string" ||
      (Array.isArray(attributions) && attributions.every((value) => typeof value === "string"))
    ) {
      source.attributions = attributions;
    }

    return source;
  }

  if (sourceNode.type === "wms") {
    const url = sourceNode.url;
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error(`Layer at index ${layerIndex} uses wms source but is missing a valid url.`);
    }

    const layers = sourceNode.layers;
    if (typeof layers !== "string" || layers.trim().length === 0) {
      throw new Error(`Layer at index ${layerIndex} uses wms source but is missing valid layers.`);
    }

    const source: TileSourceModel = {
      type: "wms",
      url,
      layers
    };

    if (typeof sourceNode.tiled === "boolean") {
      source.tiled = sourceNode.tiled;
    }

    if (typeof sourceNode.format === "string" && sourceNode.format.trim().length > 0) {
      source.format = sourceNode.format;
    }

    const attributions = sourceNode.attributions;
    if (
      typeof attributions === "string" ||
      (Array.isArray(attributions) && attributions.every((value) => typeof value === "string"))
    ) {
      source.attributions = attributions;
    }

    return source;
  }

  throw new Error(`Layer at index ${layerIndex} has unsupported source type: ${String(sourceNode.type)}.`);
}

const VECTOR_SOURCE_TYPES = ["geojson", "topojson", "kml", "gml"] as const;
type VectorSourceType = typeof VECTOR_SOURCE_TYPES[number];

function parseVectorSource(sourceNode: Record<string, unknown>, layerIndex: number): VectorSourceModel {
  const type = sourceNode.type as string;
  if (!(VECTOR_SOURCE_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Layer at index ${layerIndex} has unsupported vector source type: ${type}.`);
  }

  const url = sourceNode.url;
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error(`Layer at index ${layerIndex} uses ${type} source but is missing a valid url.`);
  }

  const source: VectorSourceModel = { type: type as VectorSourceType, url };

  return source;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
