import * as vscode from "vscode";
import * as path from "path";

class WorkspaceFolderItem extends vscode.TreeItem {
  constructor(public readonly folder: vscode.WorkspaceFolder) {
    super(folder.name, vscode.TreeItemCollapsibleState.Expanded);
    this.tooltip = folder.uri.fsPath;
    this.contextValue = "workspaceFolder";
  }
}

class OLFileItem extends vscode.TreeItem {
  constructor(public readonly uri: vscode.Uri, workspaceFolder?: vscode.WorkspaceFolder) {
    super(uri, vscode.TreeItemCollapsibleState.None);
    this.label = workspaceFolder
      ? path.relative(workspaceFolder.uri.fsPath, uri.fsPath).replace(/\\/g, "/")
      : vscode.workspace.asRelativePath(uri, false);
    this.tooltip = uri.fsPath;
    this.resourceUri = uri;
    this.command = {
      command: "vscode.openWith",
      title: "Open with Map Editor",
      arguments: [uri, "olMaps.yolEditor"]
    };
    this.contextValue = "yolFile";
  }
}

type OLTreeItem = WorkspaceFolderItem | OLFileItem;

export class OLFilesProvider implements vscode.TreeDataProvider<OLTreeItem>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<OLTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly yolWatcher: vscode.FileSystemWatcher;
  private readonly watcherDisposables: vscode.Disposable[] = [];
  private readonly workspaceFolderDisposable: vscode.Disposable;

  constructor() {
    this.yolWatcher = vscode.workspace.createFileSystemWatcher("**/*.yol");
    this.watcherDisposables.push(
      this.yolWatcher,
      this.yolWatcher.onDidCreate(() => this.refresh()),
      this.yolWatcher.onDidChange(() => this.refresh()),
      this.yolWatcher.onDidDelete(() => this.refresh())
    );
    this.workspaceFolderDisposable = vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: OLTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: OLTreeItem): Promise<OLTreeItem[]> {
    if (!element) {
      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      return workspaceFolders
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((folder) => new WorkspaceFolderItem(folder));
    }

    if (element instanceof OLFileItem) {
      return [];
    }

    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(element.folder, "**/*.yol"),
      "**/{node_modules,.git}/**"
    );

    const fileItems = files.map((fileUri) => new OLFileItem(fileUri, element.folder));
    fileItems.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
    return fileItems;
  }

  dispose(): void {
    for (const d of this.watcherDisposables) {
      d.dispose();
    }
    this.workspaceFolderDisposable.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
