/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { workspace, Disposable, window, commands, Uri, ViewColumn, TextDocument } from 'vscode';
import { LanguageClient } from 'vscode-languageclient';
import { IPlugin, IPluginResult } from '../client/plugin'
const fs = require('fs'),
  path = require('path'),
  os = require('os');

module SplitPane {

  // Map commands and their corresponding autorest args
  const registeredCommandsAndArgs = {
    "extension.autoGenCode.csharp": ["csharp"],
    "extension.autoGenCode.nodejs": ["nodejs"],
    "extension.autoGenCode.ruby": ["ruby"],
    "extension.autoGenCode.python": ["python"],
    "extension.autoGenCode.go": ["go"],
    "extension.autoGenCode.java": ["java"],
    "extension.autoGenCode.csharp.azure": ["csharp", "azure-arm"],
    "extension.autoGenCode.ruby.azure": ["ruby", "azure-arm"],
    "extension.autoGenCode.nodejs.azure": ["nodejs", "azure-arm"],
    "extension.autoGenCode.python.azure": ["python", "azure-arm"],
    "extension.autoGenCode.java.azure": ["java", "azure-arm"]
  };

  export function setup(client: LanguageClient): IPluginResult {
    console.info('Registering command to launch split pane for autogened code');
    // for each command, register handlers that can send requests to server
    Object.keys(registeredCommandsAndArgs).forEach(key => {
      commands.registerCommand(key, () => generateCode(client, registeredCommandsAndArgs[key]));
    });
    return null;
  }

  function generateCode(client: LanguageClient, args?: Array<string>) {
    const currFile: string = window.activeTextEditor.document.fileName;
    if (!(currFile.endsWith('.json') || currFile.endsWith('.md'))) {
      window.showErrorMessage(currFile + ' is not a valid OpenAPI specification file format.');
      return;
    }
    let autorestArgs = {};
    autorestArgs['inputFile'] = window.activeTextEditor.document.fileName;
    autorestArgs['additionalConfig'] = {};
    if (args) {
      args.forEach(element => autorestArgs['additionalConfig'][element] = true);
    }

    client.sendRequest('autorest.generateCode', autorestArgs).then(result => displayGeneratedCode(<string>result, args));
  }

  function writeFilesToDisk(resultObj: any) {
    let opDirPath: string = path.normalize(resultObj['outputFolder']);
    if (opDirPath.startsWith(opDirPath)) {
      opDirPath = opDirPath.replace('file:' + path.sep, '');
    }
    deleteFolderRecursive(opDirPath);

    resultObj['generatedFiles'].forEach(fileObj => {
      let fileName = path.normalize(fileObj['fileName']);
      if (fileName.startsWith('file:')) {
        fileName = fileName.replace('file:' + path.sep, '');
      }
      let dirName: string = path.dirname(fileName);
      while (!fs.existsSync(dirName)) {
        fs.mkdirSync(dirName);
        dirName = path.dirname(dirName);
      }
      fs.writeFile(fileName, fileObj['content'], { flag: 'w+' }, err => {
        if (err) {
          console.error('Could not write to file: ' + fileName);
        }
      });
    });
    window.showInformationMessage('Code generated under directory ' + opDirPath);
  }

  function deleteFolderRecursive(dirPath: string) {
    if (fs.existsSync(dirPath)) {
      fs.readdirSync(dirPath).forEach(function (file, index) {
        var curPath = path.join(dirPath, file);
        if (fs.lstatSync(curPath).isDirectory()) { // recurse
          deleteFolderRecursive(curPath);
        } else { // delete file
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(dirPath);
    }
  };

  function writeContentToSingleFile(resultObj: any, args?: Array<string>) {
    // dump generated code received into a temp file and show that file on the split pane!!!!
    // this fname is going to basically be the autorest output
    let opfname = 'output.md';
    if (args) {
      opfname = args.join('.') + '.' + opfname;
    }

    const fname: string = path.normalize(path.join(os.tmpdir(), opfname));
    let content: string = '## Generated Code\n';

    resultObj['generatedFiles'].forEach(fileObj => {
      content += '### File Name:'
      content += '\n\n[' + path.basename(fileObj['fileName']) + '](' + fileObj['fileName'] + ')' + '\n\n';
      content += '### File Content:';
      content += '\n```\n' + fileObj['content'] + '\n```\n';
    });

    fs.writeFile(fname, content, { flag: 'w+' }, (err) => {
      if (err) {
        window.showErrorMessage('Unable to write to local temp file: ' + fname);
        return;
      }
      const openPath: Uri = Uri.file(fname);

      // By default dump everything in column 2
      workspace.openTextDocument(openPath).then(doc => {
        window.showTextDocument(doc, ViewColumn.Two);
        commands.executeCommand('markdown.showPreview', openPath);
      });
    });
  }


  function displayGeneratedCode(result: string, args?: Array<string>) {
    if (!result) {
      window.showErrorMessage('Failed to generate code for given file. Please check AutoRest server log for more information.');
      return;
    }
    const resultObj = JSON.parse(result);
    writeFilesToDisk(resultObj);
    writeContentToSingleFile(resultObj, args);
  }
}
var splitPane: IPlugin = SplitPane;
export default splitPane;