# fabric-modeling-mcp

Fabric side of bw-migrating-mcp. It runs Microsoft's official Fabric MCP server ([@microsoft/fabric-mcp](https://github.com/mcp/com.microsoft/microsoft-fabric)); there is no custom server code here.

## Build

`npm run build` in bw-migrating-mcp runs `build.mjs` here when Microsoft Fabric is chosen as the migration target. It then adds `fabric-mcp` to the root `.mcp.json`. You can also run `node build.mjs` here on its own: it prints the `.mcp.json` entry instead.

The build installs the server into `node_modules` and sets up the Microsoft sign-in:

| Where you run the build | Sign-in | What the build does |
|---|---|---|
| Windows, VS Code terminal, with the **Azure Resources** extension (`ms-azuretools.vscode-azureresourcegroups`) installed | The extension's sign-in | Nothing to install. If you aren't signed in yet, it asks you to run **Azure: Sign In** from the Command Palette and waits until you have (Enter skips). |
| Anywhere else: Linux, WSL and macOS, or VS Code without Azure Resources | Azure CLI | Installs the Azure CLI into `.venv` (Python 3 with venv needed, about 750 MB), then runs `az login --use-device-code`. The sign-in is kept in `.azure`. |

The build then checks the sign-in by listing your Fabric workspaces through the server, started the same way `.mcp.json` starts it. If the server can't use the VS Code sign-in, the build switches to the Azure CLI.

On Linux, WSL and macOS the server can only reuse a VS Code sign-in through the Windows sign-in broker. Without it, it asks for a new browser sign-in on every call, so the build uses the Azure CLI there, which keeps its sign-in in `.azure` and renews it silently.

The build can't start **Azure: Sign In** itself: VS Code offers no way to run an extension command from outside. It notices the sign-in through the `~/.azure/ms-azuretools.vscode-azureresourcegroups/authRecord.json` file the extension writes.

The build checks for the extension with `code --list-extensions`, which in a VS Code terminal lists the extensions of the side the terminal runs on (WSL, SSH or local), and otherwise in the `extensions.json` of the VS Code extension folders.

Set `FABRIC_SIGN_IN=vscode` or `FABRIC_SIGN_IN=azcli` before the build to force one; then there is no automatic switch. Sign in with the account that has access to your Fabric workspaces.

`node_modules`, `.venv` and `.azure` are not tracked in git.

## Use

Start Claude Code in bw-migrating-mcp and approve `fabric-mcp` when asked. `/mcp` shows whether it connected. `start-fabric-mcp.mjs` is the launcher `.mcp.json` points to: it sets up the chosen sign-in and starts the server.

The server runs with full write access under the signed-in account: it can create, change and delete items in every workspace that account can reach.
