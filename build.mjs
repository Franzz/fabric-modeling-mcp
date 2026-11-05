#!/usr/bin/env node
// Fabric build: installs Microsoft's Fabric MCP server and its sign-in, and returns the
// .mcp.json entry for it. Called by the bw-migrating-mcp build when Microsoft Fabric is the
// migration target; `node build.mjs` runs it on its own and prints the entry.
//
// Sign-in, chosen automatically:
//   vscode  on Windows, when the build runs in VS Code and the Azure Resources extension is installed:
//           the extension's sign-in. The build waits until you run "Azure: Sign In" in VS Code.
//           Not on Linux, WSL or macOS: there the server cannot reuse that sign-in without the Windows
//           sign-in broker, and asks for a new browser sign-in on every call.
//   azcli   otherwise: the Azure CLI, installed into .venv here, signed in with its settings in .azure here.
//           The build runs the device-code sign-in.
// The build then checks the sign-in by listing your Fabric workspaces through the server. When the
// server cannot use the VS Code sign-in, the build switches to the Azure CLI (unless FABRIC_SIGN_IN is set).
//
//   FABRIC_SIGN_IN  vscode or azcli, to override the automatic choice
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';
export const venvDir = path.join(here, '.venv');
export const azureConfigDir = path.join(here, '.azure');
export const venvBin = path.join(venvDir, isWindows ? 'Scripts' : 'bin');
const az = path.join(venvBin, isWindows ? 'az.cmd' : 'az');

function log(message) {
  process.stdout.write(`[build:fabric] ${message}\n`);
}

function run(cmd, args, options = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: here, stdio: 'inherit', shell: isWindows, ...options });
}

const AZURE_RESOURCES = 'ms-azuretools.vscode-azureresourcegroups';

function isVsCode() {
  return process.env.TERM_PROGRAM === 'vscode' || Boolean(process.env.VSCODE_IPC_HOOK_CLI);
}

/** Whether the Azure Resources extension is installed where this VS Code runs (WSL, SSH or local). */
function hasAzureResources() {
  // The code CLI of a VS Code terminal lists the extensions of that side (remote or local).
  try {
    const list = execFileSync('code', ['--list-extensions'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: isWindows, timeout: 30000 });
    return list.split(/\r?\n/).some((id) => id.trim().toLowerCase() === AZURE_RESOURCES);
  } catch { /* no code CLI: look at the extension folders */ }
  const home = os.homedir();
  return ['.vscode-server', '.vscode-server-insiders', '.vscode', '.vscode-insiders']
    .map((folder) => path.join(home, folder, 'extensions', 'extensions.json'))
    .filter((file) => fs.existsSync(file))
    .some((file) => {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
          .some((ext) => ext.identifier?.id?.toLowerCase() === AZURE_RESOURCES);
      } catch { return false; }
    });
}

function chooseSignIn() {
  if (process.env.FABRIC_SIGN_IN) return process.env.FABRIC_SIGN_IN;
  if (!isWindows) {
    log(`Sign-in: Azure CLI (on ${process.platform}, the server cannot keep a VS Code sign-in between calls)`);
    return 'azcli';
  }
  if (!isVsCode()) {
    log('Sign-in: Azure CLI (not running in VS Code)');
    return 'azcli';
  }
  if (!hasAzureResources()) {
    log(`Sign-in: Azure CLI (running in VS Code, but the Azure Resources extension ${AZURE_RESOURCES} is not installed)`);
    return 'azcli';
  }
  return 'vscode';
}

function findPython() {
  for (const cmd of isWindows ? ['py', 'python'] : ['python3', 'python']) {
    try {
      execFileSync(cmd, ['-c', 'import venv, ensurepip'], { stdio: 'ignore', shell: isWindows });
      return cmd;
    } catch { /* try the next one */ }
  }
  throw new Error('The Azure CLI needs Python 3 with the venv module (on Debian/Ubuntu: sudo apt install python3-venv)');
}

function setUpAzureCli(interactive) {
  if (!fs.existsSync(az)) {
    log(`Installing the Azure CLI into ${path.relative(process.cwd(), venvDir) || venvDir} (several hundred MB, a few minutes)`);
    run(findPython(), ['-m', 'venv', venvDir]);
    run(path.join(venvBin, isWindows ? 'python.exe' : 'python'), ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip', 'azure-cli']);
  }
  const env = { ...process.env, AZURE_CONFIG_DIR: azureConfigDir };
  let account = null;
  try {
    account = JSON.parse(execFileSync(az, ['account', 'show', '--output', 'json'],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: isWindows }));
  } catch { /* not signed in */ }
  if (account) {
    log(`Azure CLI signed in as ${account.user?.name} (tenant ${account.tenantId})`);
  } else if (interactive) {
    log('Sign in with the account that has access to your Fabric workspaces:');
    run(az, ['login', '--use-device-code', '--allow-no-subscriptions'], { env });
  } else {
    log(`Not signed in. Run: AZURE_CONFIG_DIR="${azureConfigDir}" "${az}" login --use-device-code --allow-no-subscriptions`);
  }
}

// Written by the Azure Resources extension after "Azure: Sign In"; the server's VS Code sign-in reads it.
const authRecordFile = path.join(os.homedir(), '.azure', AZURE_RESOURCES, 'authRecord.json');

function readAuthRecord() {
  try {
    return JSON.parse(fs.readFileSync(authRecordFile, 'utf8'));
  } catch {
    return null;
  }
}

/** Waits for "Azure: Sign In" in VS Code: until the sign-in record appears, or Enter skips. */
async function setUpVsCode(interactive) {
  let record = readAuthRecord();
  if (!record) {
    const instruction = 'In VS Code, open the Command Palette (Ctrl+Shift+P), run "Azure: Sign In" and pick'
      + ' the account that has access to your Fabric workspaces.';
    if (!interactive) {
      log(`Not signed in. ${instruction}`);
      return;
    }
    log(instruction);
    log('Waiting for the sign-in (Enter to skip)...');
    const rl = readline.createInterface({ input: process.stdin });
    record = await new Promise((resolve) => {
      const timer = setInterval(() => {
        const found = readAuthRecord();
        if (found) done(found);
      }, 2000);
      rl.once('line', () => done(null));
      function done(value) {
        clearInterval(timer);
        rl.close();
        resolve(value);
      }
    });
    if (!record) {
      log('Skipped: sign in later with "Azure: Sign In", then reload VS Code.');
      return;
    }
  }
  log(`VS Code signed in as ${record.username} (tenant ${record.tenantId})`);
}

/**
 * Starts the server the way .mcp.json will and lists the Fabric workspaces through it.
 * Returns null when that works, otherwise the reason it didn't.
 */
function verifySignIn(signIn) {
  log('Checking the sign-in: listing your Fabric workspaces through the server...');
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fabric-build', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'core_list-workspaces', arguments: {} } },
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, 'start-fabric-mcp.mjs')],
      { env: { ...process.env, FABRIC_SIGN_IN: signIn }, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    let settled = false;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(reason);
    };
    const timer = setTimeout(() => finish('no answer from the server within 90 seconds'), 90000);
    child.on('error', (err) => finish(err.message));
    child.on('exit', (code) => finish(`the server stopped (exit code ${code})`));
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id !== 2) continue;
        if (message.error) return finish(message.error.message);
        const text = message.result?.content?.map((c) => c.text).join(' ') ?? '';
        if (!message.result?.isError) return finish(null);
        let reason = text;
        try { reason = JSON.parse(text).message ?? text; } catch { /* plain text */ }
        return finish(reason);
      }
    });
    child.stdin.write(messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
  });
}

/**
 * Installs the server and the sign-in, and checks that the server can reach Fabric with it.
 * Returns the mcpServers entries to put into .mcp.json.
 * interactive: whether the sign-in may ask or wait in the terminal.
 */
export async function build({ interactive = process.stdin.isTTY && process.stdout.isTTY } = {}) {
  run('npm', [fs.existsSync(path.join(here, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund']);

  let signIn = chooseSignIn();
  if (!['vscode', 'azcli'].includes(signIn)) throw new Error(`FABRIC_SIGN_IN must be vscode or azcli, not "${signIn}"`);

  if (signIn === 'vscode') {
    log('Sign-in: VS Code (Azure Resources extension)');
    await setUpVsCode(interactive);
    if (readAuthRecord()) {
      const problem = await verifySignIn('vscode');
      if (!problem) {
        log('Sign-in works: the server can list your Fabric workspaces');
      } else if (process.env.FABRIC_SIGN_IN) {
        log(`The server cannot use the VS Code sign-in: ${problem}`);
      } else {
        log(`The server cannot use the VS Code sign-in (${problem}). Switching to the Azure CLI.`);
        signIn = 'azcli';
      }
    }
  }
  if (signIn === 'azcli') {
    setUpAzureCli(interactive);
    const problem = await verifySignIn('azcli');
    log(problem ? `The server cannot use the Azure CLI sign-in yet: ${problem}`
      : 'Sign-in works: the server can list your Fabric workspaces');
  }
  log(`Fabric MCP server ready (sign-in: ${signIn})`);

  return {
    'fabric-mcp': {
      type: 'stdio',
      command: 'node',
      args: [path.join(here, 'start-fabric-mcp.mjs')],
      env: { FABRIC_SIGN_IN: signIn },
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const servers = await build();
    process.stdout.write(`${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`[build:fabric] failed: ${err.message}\n`);
    process.exit(1);
  }
}
