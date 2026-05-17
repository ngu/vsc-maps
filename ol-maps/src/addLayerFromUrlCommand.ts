import * as vscode from "vscode";
import { DocumentEditor } from "./documentEditor";
import type { LayerModel, TileSourceModel, WebviewPayload } from "./olModel";

type SourceType = "osm" | "xyz" | "wms";

type SourceInputHandler = () => Promise<TileSourceModel | undefined>;

type SourceTypeOption = {
  label: string;
  value: SourceType;
  description: string;
  handler: SourceInputHandler;
};

const SOURCE_TYPE_OPTIONS: Record<SourceType, SourceTypeOption> = {
  osm: {
    label: "OSM",
    value: "osm",
    description: "OpenStreetMap default tile source",
    handler: async () => ({ type: "osm" })
  },
  xyz: {
    label: "XYZ",
    value: "xyz",
    description: "Template URL with {z}/{x}/{y}",
    handler: async () => {
      const serviceUrl = await promptServiceUrl("https://example.com/tiles/{z}/{x}/{y}.png");
      if (!serviceUrl) {
        return undefined;
      }

      return {
        type: "xyz",
        url: serviceUrl
      };
    }
  },
  wms: {
    label: "WMS",
    value: "wms",
    description: "OGC WMS endpoint + LAYERS",
    handler: async () => {
      const serviceUrl = await promptServiceUrl("https://example.com/geoserver/wms");
      if (!serviceUrl) {
        return undefined;
      }

      const layers = await promptWmsLayers();
      if (!layers) {
        return undefined;
      }

      return {
        type: "wms",
        url: serviceUrl,
        layers,
        tiled: true
      };
    }
  }
};

export async function addLayerFromUrlCommand(
  parseYolToPayload: (rawText: string) => WebviewPayload
): Promise<void> {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    void vscode.window.showWarningMessage("Open a .yol text editor first.");
    return;
  }

  const document = activeEditor.document;
  const isYolDocument =
    document.languageId === "yol" ||
    document.uri.path.toLowerCase().endsWith(".yol");

  if (!isYolDocument) {
    void vscode.window.showWarningMessage("The active editor is not a .yol document.");
    return;
  }

  const selectedSourceType = await promptSourceType();
  if (!selectedSourceType) {
    return;
  }

  const source = await selectedSourceType.handler();
  if (!source) {
    return;
  }

  await applySourceToActiveDocument(parseYolToPayload, source);
}

async function promptSourceType(): Promise<SourceTypeOption | undefined> {
  const selected = await vscode.window.showQuickPick(
    Object.values(SOURCE_TYPE_OPTIONS),
    {
      title: "Add Map Service Layer",
      placeHolder: "Select the source type",
      ignoreFocusOut: true
    }
  );

  return selected;
}

async function promptServiceUrl(exampleUrl: string): Promise<string | undefined> {
  const serviceUrl = await vscode.window.showInputBox({
    title: "Add Map Service Layer",
    prompt: "Enter the map service URL.",
    placeHolder: exampleUrl,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim().length === 0 ? "URL is required." : undefined)
  });

  return serviceUrl?.trim();
}

async function promptWmsLayers(): Promise<string | undefined> {
  const layers = await vscode.window.showInputBox({
    title: "Add WMS Layer",
    prompt: "Enter WMS LAYERS value (comma-separated for multiple layers).",
    placeHolder: "workspace:roads,workspace:labels",
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim().length === 0 ? "WMS layers are required." : undefined)
  });

  return layers?.trim();
}

async function applySourceToActiveDocument(
  parseYolToPayload: (rawText: string) => WebviewPayload,
  source: TileSourceModel
): Promise<void> {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    void vscode.window.showWarningMessage("Open a .yol text editor first.");
    return;
  }

  const document = activeEditor.document;
  const payload = parseYolToPayload(document.getText());
  if (payload.type !== "updateModel") {
    const parseMessage = payload.type === "parseError" ? payload.error : payload.message;
    void vscode.window.showErrorMessage(
      `Cannot add layer because the YOL document is invalid: ${parseMessage}`
    );
    return;
  }

  const nextLayers: LayerModel[] = [
    ...payload.model.layers,
    {
      type: "tile",
      source
    }
  ];

  try {
    const documentEditor = new DocumentEditor(document);
    await documentEditor.applyEdit({
      type: "edit",
      payload: {
        editType: "replace",
        path: "layers",
        value: nextLayers
      }
    });
    void vscode.window.showInformationMessage("Added map service layer to YOL document.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown add-layer error.";
    void vscode.window.showErrorMessage(`Failed to add map service layer: ${message}`);
  }
}
