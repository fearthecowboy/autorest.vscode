// ---------------------------------------------------------------------------------------------
//  Copyright (c) Microsoft Corporation. All rights reserved.
//  Licensed under the MIT License. See License.txt in the project root for license information.
// ---------------------------------------------------------------------------------------------

// The settings interface describe the server relevant settings part
export interface Settings {
  autorest: AutoRestSettings;
}

// These are the settings we defined in the client's package.json
// file
export interface AutoRestSettings {
  maxNumberOfProblems: number;
  information: boolean;
  verbose: boolean;
  debug: boolean;
  runtimeId: string;
  minimumAutoRestVersion: string;
  configuration: any;
}