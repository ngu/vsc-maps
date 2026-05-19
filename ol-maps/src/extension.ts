import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { DocumentEditor } from "./documentEditor";
import { addLayerFromUrlCommand } from "./addLayerFromUrlCommand";
import { OLFilesProvider } from "./olFilesProvider";
import type {
  WebviewDebugMessage,
  WebviewEdit,
  WebviewEditMessage,
  WebviewPayload
} from "./olModel";
import { toOLModel } from "./olModel";

const lastParseErrorByDocument = new Map<string, string>();

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("OL Maps");
  context.subscriptions.push(outputChannel);

  const olFilesProvider = new OLFilesProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("openlayers.yolFiles", olFilesProvider),
    olFilesProvider
  );

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "olMaps.yolEditor",
      new YOLCustomEditorProvider(context, outputChannel),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("olMaps.addLayerFromUrl", async () => {
      await addLayerFromUrlCommand((rawText) =>
        parseYolToPayload(rawText, outputChannel, vscode.window.activeTextEditor?.document.uri)
      );
    })
  );

}

class YOLCustomEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const documentEditor = new DocumentEditor(document);
    const initialMessage = resolveVectorSourceUrls(
      parseYolToPayload(document.getText(), this.outputChannel, document.uri),
      document,
      webviewPanel.webview
    );

    const localResourceRoots = [
      vscode.Uri.joinPath(this.extensionContext.extensionUri, "media")
    ];
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (workspaceFolder) {
      localResourceRoots.push(workspaceFolder.uri);
    } else {
      localResourceRoots.push(vscode.Uri.joinPath(document.uri, ".."));
    }

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots
    };

    const updateWebview = (): void => {
      const rawText = document.getText();
      const message = resolveVectorSourceUrls(
        parseYolToPayload(rawText, this.outputChannel, document.uri),
        document,
        webviewPanel.webview
      );
      webviewPanel.webview.postMessage(message).then(
        undefined,
        (error: unknown) => {
          const errorText = error instanceof Error ? error.message : "Unknown webview postMessage error";
          logOutputError(
            this.outputChannel,
            `Failed to post an update to the YOL webview: ${errorText}`,
            document.uri,
            error,
            false
          );
          void vscode.window.showWarningMessage(`YOL editor sync warning: ${errorText}`);
        }
      );
    };

    const inboundSub = webviewPanel.webview.onDidReceiveMessage(
      async (message: unknown) => {
        if (isDebugMessage(message)) {
          logOutputDebug(this.outputChannel, message.message, document.uri);
          return;
        }

        if (!isEditMessage(message)) {
          return;
        }

        try {
          await documentEditor.applyEdit(message);
          const edits = Array.isArray(message.payload) ? message.payload : [message.payload];
          await webviewPanel.webview.postMessage({
            type: "operationResult",
            ok: true,
            message: edits.length === 1 ? `Replaced ${edits[0].path}` : `Applied ${edits.length} edits`
          } satisfies WebviewPayload);
        } catch (error) {
          const errorText = error instanceof Error ? error.message : "Unknown replacement error";
          logOutputError(
            this.outputChannel,
            `Failed to apply edits from the YOL webview: ${errorText}`,
            document.uri,
            error,
            false
          );
          await webviewPanel.webview.postMessage({
            type: "operationResult",
            ok: false,
            message: errorText
          } satisfies WebviewPayload);
        }
      }
    );

    const changeDocSub = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.webview.html = getWebviewHtml(
      webviewPanel.webview,
      this.extensionContext.extensionUri,
      initialMessage
    );

    webviewPanel.onDidDispose(() => {
      changeDocSub.dispose();
      inboundSub.dispose();
    });
  }
}

function resolveVectorSourceUrls(
  message: WebviewPayload,
  document: vscode.TextDocument,
  webview: vscode.Webview
): WebviewPayload {
  if (message.type !== "updateModel") {
    return message;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const docDir = vscode.Uri.joinPath(document.uri, "..");

  const resolvedLayers = message.model.layers.map((layer) => {
    if (layer.type !== "vector") {
      return layer;
    }
    const rawUrl = layer.source.url;
    let resolvedUri: vscode.Uri | undefined;

    if (rawUrl.startsWith("/") && !rawUrl.startsWith("//")) {
      if (workspaceFolder) {
        resolvedUri = vscode.Uri.joinPath(workspaceFolder.uri, rawUrl);
      }
    } else if (rawUrl.startsWith("./")) {
      resolvedUri = vscode.Uri.joinPath(docDir, rawUrl.slice(2));
    }

    if (!resolvedUri) {
      return layer;
    }

    return {
      ...layer,
      source: { ...layer.source, url: webview.asWebviewUri(resolvedUri).toString() }
    };
  });

  return {
    ...message,
    model: { ...message.model, layers: resolvedLayers }
  };
}

function parseYolToPayload(
  rawText: string,
  outputChannel?: vscode.OutputChannel,
  documentUri?: vscode.Uri
): WebviewPayload {
  try {
    const parsed = yaml.load(rawText);
    const model = toOLModel(parsed);

    if (documentUri) {
      lastParseErrorByDocument.delete(documentUri.toString());
    }

    return {
      type: "updateModel",
      model,
      rawText
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    const documentKey = documentUri?.toString();
    const shouldLog = documentKey === undefined || lastParseErrorByDocument.get(documentKey) !== message;

    if (documentKey) {
      lastParseErrorByDocument.set(documentKey, message);
    }

    if (outputChannel && shouldLog) {
      logOutputError(
        outputChannel,
        `Failed to parse YOL document: ${message}`,
        documentUri,
        error,
        true
      );
    }

    return {
      type: "parseError",
      error: message,
      rawText
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEditMessage(value: unknown): value is WebviewEditMessage {
  if (!isRecord(value) || value.type !== "edit" || !("payload" in value)) {
    return false;
  }

  const payload = value.payload;
  if (Array.isArray(payload)) {
    return payload.length > 0 && payload.every(isReplaceEdit);
  }

  return isReplaceEdit(payload);
}

function isDebugMessage(value: unknown): value is WebviewDebugMessage {
  return isRecord(value) && value.type === "debug" && typeof value.message === "string";
}

function isReplaceEdit(value: unknown): value is WebviewEdit {
  return (
    isRecord(value) &&
    value.editType === "replace" &&
    typeof value.path === "string" &&
    "value" in value
  );
}

function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  initialMessage: WebviewPayload
): string {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "app.js"));
  const nonce = getNonce();
  const initialMessageJson = serializeForInlineScript(initialMessage);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline' https:; script-src ${webview.cspSource} 'nonce-${nonce}' https:; font-src https:; connect-src ${webview.cspSource} https:;"
  />
  <title>YOL Map Editor</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div class="layout">
    <div id="map" aria-label="OpenLayers map"></div>
  </div>
  <script nonce="${nonce}">
    window.__olMapsVscode = window.__olMapsVscode || acquireVsCodeApi();
    window.__olMapsInitialPayload = ${initialMessageJson};
    import("${scriptUri}");
  </script>
</body>
</html>`;
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function logOutputError(
  outputChannel: vscode.OutputChannel,
  message: string,
  documentUri?: vscode.Uri,
  error?: unknown,
  showChannel = false
): void {
  const prefix = `[${new Date().toISOString()}]`;
  const location = documentUri ? ` ${documentUri.fsPath}` : "";
  outputChannel.appendLine(`${prefix} ERROR${location} ${message}`);

  if (error instanceof Error && error.stack) {
    outputChannel.appendLine(error.stack);
  }

  if (showChannel) {
    outputChannel.show(true);
  }
}

function logOutputDebug(
  outputChannel: vscode.OutputChannel,
  message: string,
  documentUri?: vscode.Uri
): void {
  const prefix = `[${new Date().toISOString()}]`;
  const location = documentUri ? ` ${documentUri.fsPath}` : "";
  outputChannel.appendLine(`${prefix} DEBUG${location} ${message}`);
}
