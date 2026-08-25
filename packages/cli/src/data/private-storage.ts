import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { privateChildEnv } from "./child-process.ts";

function clearInheritedAcl(path: string): void {
	if (process.platform !== "darwin") return;
	const result = spawnSync("/bin/chmod", ["-N", path], { env: privateChildEnv(), stdio: "ignore" });
	if (result.status !== 0) throw new Error("Could not clear inherited filesystem permissions");
}

export function ensurePrivateDir(path: string): void {
	if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
	clearInheritedAcl(path);
	chmodSync(path, 0o700);
}

export function writePrivateFile(path: string, data: string | NodeJS.ArrayBufferView): void {
	ensurePrivateDir(dirname(path));
	writePrivateFileAtomically(path, data);
}

export function writePrivateOutputFile(path: string, data: string | NodeJS.ArrayBufferView): void {
	const parent = dirname(path);
	if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
	writePrivateFileAtomically(path, data);
}

function writePrivateFileAtomically(path: string, data: string | NodeJS.ArrayBufferView): void {
	const temp = join(dirname(path), `.${Date.now()}-${randomBytes(6).toString("hex")}.tmp`);
	try {
		writeFileSync(temp, data, { mode: 0o600 });
		clearInheritedAcl(temp);
		chmodSync(temp, 0o600);
		renameSync(temp, path);
		clearInheritedAcl(path);
		chmodSync(path, 0o600);
	} catch (error) {
		if (existsSync(temp)) unlinkSync(temp);
		throw error;
	}
}

export function appendPrivateFile(path: string, data: string): void {
	ensurePrivateDir(dirname(path));
	appendFileSync(path, data, { mode: 0o600 });
	clearInheritedAcl(path);
	chmodSync(path, 0o600);
}

export function secureExistingFile(path: string): void {
	if (!existsSync(path)) return;
	clearInheritedAcl(path);
	chmodSync(path, 0o600);
}
