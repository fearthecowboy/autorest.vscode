// ---------------------------------------------------------------------------------------------
//  Copyright (c) Microsoft Corporation. All rights reserved.
//  Licensed under the MIT License. See License.txt in the project root for license information.
// ---------------------------------------------------------------------------------------------

/***********************
 * Data aquisition
 ***********************/
import * as promisify from "pify";
import { Readable } from "stream";
import { parse } from "url";
import { sep, extname } from "path";

const stripBom: (text: string) => string = require("strip-bom");
const getUri = require("get-uri");
const getUriAsync: (uri: string) => Promise<Readable> = promisify(getUri);

/**
 * Loads a UTF8 string from given URI.
 */
export async function ReadUri(uri: string): Promise<string> {
  try {
    const readable = await getUriAsync(uri);

    const readAll = new Promise<string>(function (resolve, reject) {
      let result = "";
      readable.on("data", data => result += data.toString());
      readable.on("end", () => resolve(result));
      readable.on("error", err => reject(err));
    });

    return stripBom(await readAll);
  } catch (e) {
    throw new Error(`Failed to load '${uri}' (${e})`);
  }
}


/***********************
 * URI manipulation
 ***********************/
import { isAbsolute } from "path";
const URI = require("urijs");
const fileUri: (path: string, options: { resolve: boolean }) => string = require("file-url");

export function NormalizeUri(uri: string): string {
  return uri.replace("%3A", ":").replace(/(.:)/ig, (v) => v.toLowerCase());
}

/**
 * Create a 'file:///' URI from given path, performing no checking of path validity whatsoever.
 * Possible usage includes:
 * - making existing local paths consumable by `readUri` (e.g. "C:\swagger\storage.yaml" -> "file:///C:/swagger/storage.yaml")
 * - creating "fake" URIs for virtual FS files (e.g. "input/swagger.yaml" -> "file:///input/swagger.yaml")
 */
export function CreateFileUri(path: string): string {
  if (path.startsWith("file://")) {
    return NormalizeUri(path);
  }
  return NormalizeUri(fileUri(path, { resolve: false }));
}

export function FileUriToPath(fileUri: string): string {
  const uri = parse(fileUri);
  if (uri.protocol !== "file:") {
    throw `Protocol '${uri.protocol}' not supported for writing.`;
  }
  // convert to path
  let p = uri.path;
  if (p === undefined) {
    throw `Cannot write to '${uri}'. Path not found.`;
  }
  if (sep === "\\") {
    p = p.substr(p.startsWith("/") ? 1 : 0);
    p = p.replace(/\//g, "\\");
  }
  return NormalizeUri(p);
}

/**
 * The singularity of all resolving.
 * With URI as our one data type of truth, this method maps an absolute or relative path or URI to a URI using given base URI.
 * @param baseUri   Absolute base URI
 * @param pathOrUri Relative/absolute path/URI
 * @returns Absolute URI
 */
export function ResolveUri(baseUri: string, pathOrUri: string): string {
  if (isAbsolute(pathOrUri)) {
    return CreateFileUri(pathOrUri);
  }
  pathOrUri = pathOrUri.replace(/\\/g, "/");
  if (!baseUri) {
    throw "'pathOrUri' was detected to be relative so 'baseUri' is required";
  }
  return NormalizeUri(new URI(pathOrUri).absoluteTo(baseUri).toString());
}

export function GetExtension(name: string) {
  let ext = extname(name);
  if (ext) {
    return ext.substr(1).toLowerCase();
  }
  return ext;
}