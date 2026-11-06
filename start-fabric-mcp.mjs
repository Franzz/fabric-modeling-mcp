#!/usr/bin/env node
// Fabric launcher: sets up the sign-in chosen by build.mjs, then starts Microsoft's Fabric MCP
// server (stdio) from node_modules here. Variables already set in the environment win.
//
//   FABRIC_SIGN_IN  vscode: VS Code's sign-in (Azure Resources extension, "Azure: Sign In")
//                   azcli (default): the Azure CLI in .venv here, with its sign-in in .azure here
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { azureConfigDir, venvBin } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };

function fail(message) {
  process.stderr.write(`[start-fabric-mcp] ${message}\n`);
  process.exit(1);
}

const signIn = env.FABRIC_SIGN_IN || 'azcli';
if (signIn === 'azcli') {
  if (!fs.existsSync(venvBin)) fail(`Azure CLI not installed in ${venvBin} (run npm run build in bw-migrating-mcp)`);
  env.PATH = `${venvBin}${path.delimiter}${env.PATH}`;
  env.AZURE_CONFIG_DIR ||= azureConfigDir;
  env.AZURE_TOKEN_CREDENTIALS ||= 'AzureCliCredential';
} else if (signIn === 'vscode') {
  env.AZURE_TOKEN_CREDENTIALS ||= 'VisualStudioCodeCredential';
} else {
  fail(`FABRIC_SIGN_IN must be vscode or azcli, not "${signIn}"`);
}

const entry = path.join(here, 'node_modules/@microsoft/fabric-mcp/index.js');
if (!fs.existsSync(entry)) fail(`${entry} not found (run npm run build in bw-migrating-mcp)`);

const child = spawn(process.execPath, [entry, 'server', 'start', '--mode', 'all', '--dangerously-disable-elicitation'], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
