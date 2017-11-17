/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { window, StatusBarItem, StatusBarAlignment, workspace, ProgressLocation, Progress } from 'vscode';
import { IPlugin, IPluginResult } from './plugin'
import { AutoRestLanguageService, DocumentType } from "autorest";

let statusBarItem: StatusBarItem;

let languageService: AutoRestLanguageService;

export function setupStatusBar(service: AutoRestLanguageService): IPluginResult {
  languageService = service;

  if (!statusBarItem) {
    statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 5000);
  }
  statusBarItem.command = "extension.autorest.generate";

  // todo: reset this on configuration change.
  statusBarItem.tooltip = `Click to preview code in ${workspace.getConfiguration("autorest").get("language", "csharp")}`;

  window.onDidChangeActiveTextEditor(async (e) => await setStatus("idle"), null, [])

  let editor = window.activeTextEditor;
  if (!editor) {
    statusBarItem.hide();
    return null;
  }
  setStatus("idle");
  return null;
}

export async function setStatus(message: string) {
  if (statusBarItem) {
    let editor = window.activeTextEditor;
    if (!editor) {
      statusBarItem.hide();
      return null;
    }
    // update tooltip (config might have changed.)
    statusBarItem.tooltip = `Click to preview code in ${workspace.getConfiguration("autorest").get("language", "csharp")}`;

    if (message === 'idle') {
      if (editor.document && editor.document.uri) {
        try {
          const documentType = await languageService.identifyDocument(editor.document.uri.toString());

          switch (await languageService.identifyDocument(editor.document.uri.toString())) {
            case DocumentType.LiterateConfiguration:
              setStatus("Configuration");
              return;
            case DocumentType.OpenAPI2:
              setStatus("OpenAPI 2.0");
              return;
            case DocumentType.OpenAPI3:
              setStatus("OpenAPI 3.0");
              return;
          }

        }
        catch (E) {
          // console.log(E);
        }
      }
      statusBarItem.hide();
      return;
    }

    statusBarItem.text = `AutoRest:[${message}]`;
    statusBarItem.show();
  }
}

const activities = new Map<string, { progress: Progress<{ message: string }>, end: () => void }>();

export async function endActivity(id: string) {
  const p = activities.get(id);
  if (p) {
    p.end();
  }
  activities.delete(id);
}


export async function startActivity(params: { id: string, title: string, message: string }) {
  // check to see if we have an active activity with that id
  const activity = activities.get(params.id);
  if (activity) {
    // yes! just set the current message 
    activity.progress.report({ message: params.message });
    return;
  }

  // no, let's start a new activity
  window.withProgress({ location: ProgressLocation.Window, title: params.title }, async (progress: Progress<{ message: string }>) => {

    // call this to end the activity.
    let onEnd: () => void;

    // promise to await for the end of the activity
    const completed = new Promise<void>((resolve, reject) => onEnd = resolve)

    // put it into the list of active activities.
    activities.set(params.id, { progress: progress, end: onEnd });

    // set the current message 
    progress.report({ message: params.message });

    await completed;
  });
}

