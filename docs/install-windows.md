# Run the fictional demo on Windows

## Get the tools and source

1. Install the **Node.js 24 LTS** Windows installer for your computer from the [Node.js download page](https://nodejs.org/en/download). Keep npm selected. Open a new PowerShell window after installation.
2. Run `node --version` and `npm.cmd --version`. The first should start with `v24.`. If either command is missing, reopen PowerShell and check the Node installation.
3. On the reviewed [LMS GitHub source](https://github.com/larrinamsalva/LMS), choose **Code → Download ZIP**. In File Explorer, right-click the ZIP, choose **Extract All**, and open the extracted folder containing `package.json`. You can also clone with Git. A reviewed release candidate may offer a ZIP and matching checksum. See [how to check the download](release-candidate.md#source-candidate-and-integrity).
4. Open PowerShell in that folder. One way is to type `powershell` in the File Explorer address bar and press **Enter**.

## Install, build and start

Run these commands in order. Wait for each command to finish successfully before typing the next.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run demo
```

When the terminal shows that the server is ready, open **http://127.0.0.1:3000** in a browser on this computer. Choose **Explore the working demo**. Use the **Business workspace** menu to try the cleaning company or property manager. The screenshots and first visit walkthrough show what to look for. [First-release guide](first-release.md#first-visit)

Keep the PowerShell window open while you use LMS. Press **Ctrl+C** there to stop it. If Windows asks **Terminate batch job (Y/N)?**, type **Y** and press **Enter**. Before stopping, export any configuration you want to keep. Demo records, drafts and assets disappear on restart, and sessions expire after two hours.

### Optional PowerShell helper

Run `.\scripts\start-demo.ps1` from the extracted folder to run the same npm steps. On later visits, `.\scripts\start-demo.ps1 -StartOnly` starts the existing build. If PowerShell blocks the script, use the three `npm.cmd` commands above. They use the same launcher and work with the existing PowerShell policy.

| If you see | Do this |
| --- | --- |
| `node` or `npm.cmd` is missing | Install Node.js 24 with npm and reopen PowerShell. |
| The install or build fails | Read the first error in the terminal. Confirm you extracted the full ZIP, have internet access for npm, and are in the folder with `package-lock.json`. Run the failed command again after fixing its error. |
| The port is already in use | Stop the other server, or run `npm.cmd run demo -- --port 3200` and open **http://127.0.0.1:3200**. The helper also accepts `-StartOnly -Port 3200`. |
| The browser opens but changes fail | Use the numeric **127.0.0.1** address and the exact port printed by the launcher. |
| The launcher refuses environment files | Extract the demo into a clean folder. Use a separate checkout for experiments that need environment files. |

**Use made-up data only.** The demo uses a local temporary database and requires no login or API key. See [tested platforms and release limits](release-candidate.md).
