import * as vscode from "vscode";
import type { WebviewEdit, WebviewEditMessage } from "./olModel";
import { applyReplacementToRawText } from "./documentEdits";

export class DocumentEditor {
  constructor(private readonly document: vscode.TextDocument) {}

  async applyEdit(message: WebviewEditMessage): Promise<void> {
    const docUri = this.document.uri;
    const liveDoc = await vscode.workspace.openTextDocument(docUri);
    let nextText = liveDoc.getText();

    const edits = Array.isArray(message.payload) ? message.payload : [message.payload];
    for (const editOp of edits) {
      nextText = applySingleEdit(nextText, editOp);
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(docUri, fullDocumentRange(liveDoc), nextText);
    const applied = await vscode.workspace.applyEdit(edit);

    if (!applied) {
      throw new Error("VS Code rejected applying the YAML edit.");
    }
  }
}

function applySingleEdit(rawText: string, edit: WebviewEdit): string {
  switch (edit.editType) {
    case "replace":
      return applyReplacementToRawText(rawText, edit.path, edit.value);
    default:
      throw new Error(`Unsupported edit type: ${String(edit.editType)}.`);
  }
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLine = Math.max(document.lineCount - 1, 0);
  const endCharacter = document.lineAt(lastLine).text.length;
  return new vscode.Range(0, 0, lastLine, endCharacter);
}