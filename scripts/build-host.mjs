// Compiles native/*.cs into resources/bin/VyseHost.exe with the C# compiler that ships with
// Windows (.NET Framework 4.8), so building VyseBar needs no .NET SDK.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const src = join(root, "native");
const outDir = join(root, "resources", "bin");
const out = join(outDir, "VyseHost.exe");
const netDir = join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET");
// 32-bit Windows only has Framework\; either compiler builds the same AnyCPU helper
const fw = [join(netDir, "Framework64", "v4.0.30319"), join(netDir, "Framework", "v4.0.30319")].find((d) => existsSync(join(d, "csc.exe"))) ?? join(netDir, "Framework", "v4.0.30319");
const winmd = join(process.env.WINDIR ?? "C:\\Windows", "System32", "WinMetadata");
const csc = join(fw, "csc.exe");

if (process.platform !== "win32") {
  console.log("build-host: not on Windows, skipping");
  process.exit(0);
}
if (!existsSync(csc)) {
  console.error(`build-host: ${csc} not found - .NET Framework 4.8 is part of Windows 10/11`);
  process.exit(1);
}

const sources = readdirSync(src).filter((f) => f.endsWith(".cs")).map((f) => join(src, f));
const newest = Math.max(...sources.map((f) => statSync(f).mtimeMs), statSync(import.meta.filename).mtimeMs);
if (existsSync(out) && statSync(out).mtimeMs > newest && !process.argv.includes("--force")) {
  console.log("build-host: VyseHost.exe is up to date");
  process.exit(0);
}
mkdirSync(outDir, { recursive: true });

const refs = [
  "System.dll",
  "System.Core.dll",
  "Microsoft.CSharp.dll",
  "System.Drawing.dll",
  "System.Management.dll",
  "System.Windows.Forms.dll",
  "System.Web.Extensions.dll",
  join(fw, "System.Runtime.dll"),
  join(fw, "System.Runtime.InteropServices.WindowsRuntime.dll"),
  join(fw, "System.Threading.Tasks.dll"),
  join(fw, "System.IO.dll"),
  join(winmd, "Windows.Foundation.winmd"),
  join(winmd, "Windows.Media.winmd"),
  join(winmd, "Windows.Storage.winmd"),
  join(winmd, "Windows.Devices.winmd"),
  join(winmd, "Windows.Networking.winmd"),
  join(winmd, "Windows.Graphics.winmd"),
  join(winmd, "Windows.System.winmd"),
].filter((r) => !r.includes("\\") || existsSync(r));

const args = [
  "/nologo",
  "/target:winexe",
  // AnyCPU: one helper that runs as 64-bit on 64-bit Windows and as 32-bit on 32-bit Windows
  "/platform:anycpu",
  "/optimize+",
  `/out:${out}`,
  ...refs.map((r) => `/r:${r}`),
  ...sources,
];

try {
  const log = execFileSync(csc, args, { encoding: "utf8" });
  if (log.trim()) console.log(log.trim());
  console.log(`build-host: wrote ${out}`);
} catch (e) {
  console.error(e.stdout || e.message);
  process.exit(1);
}
