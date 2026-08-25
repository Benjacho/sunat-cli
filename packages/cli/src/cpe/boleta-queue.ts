/**
 * Buffer of boletas pending daily-summary submission.
 *
 * Stored as JSONL at ~/.sunat/boletas-pending/{YYYY-MM-DD}.jsonl, keyed by the
 * boleta's fechaEmision. `cpe boleta queue` appends; `cpe resumen send --fecha`
 * consumes and clears the file (after successful CDR).
 *
 * Multi-emisor: file is per-RUC namespaced via the entry itself (each line
 * carries emisorRuc), so a single config can manage several RUCs in parallel.
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../data/config.ts";
import { appendPrivateFile, ensurePrivateDir, secureExistingFile, writePrivateFile } from "../data/private-storage.ts";
import type { BoletaInput } from "./drivers/types.ts";

export interface QueuedBoleta {
	queuedAt: string; // ISO timestamp when buffered
	emisorRuc: string;
	input: BoletaInput;
}

const QUEUE_DIR = join(paths.sunatDir, "boletas-pending");

function ensureDir(): void {
	ensurePrivateDir(QUEUE_DIR);
}

export function queuePath(fechaEmision: string): string {
	return join(QUEUE_DIR, `${fechaEmision}.jsonl`);
}

export function enqueueBoleta(emisorRuc: string, input: BoletaInput): { file: string; total: number } {
	ensureDir();
	const file = queuePath(input.fechaEmision);
	const entry: QueuedBoleta = {
		queuedAt: new Date().toISOString(),
		emisorRuc,
		input,
	};
	appendPrivateFile(file, `${JSON.stringify(entry)}\n`);
	const total = readQueue(input.fechaEmision).filter((q) => q.emisorRuc === emisorRuc).length;
	return { file, total };
}

export function readQueue(fechaEmision: string): QueuedBoleta[] {
	const file = queuePath(fechaEmision);
	if (!existsSync(file)) return [];
	secureExistingFile(file);
	return readFileSync(file, "utf-8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as QueuedBoleta);
}

export function listQueueDates(): string[] {
	if (!existsSync(QUEUE_DIR)) return [];
	return readdirSync(QUEUE_DIR)
		.filter((f) => f.endsWith(".jsonl"))
		.map((f) => f.replace(/\.jsonl$/, ""))
		.sort();
}

export function clearQueue(fechaEmision: string): void {
	const file = queuePath(fechaEmision);
	if (existsSync(file)) unlinkSync(file);
}

export function clearQueueForEmisor(fechaEmision: string, emisorRuc: string): void {
	const file = queuePath(fechaEmision);
	if (!existsSync(file)) return;
	const remaining = readQueue(fechaEmision).filter((q) => q.emisorRuc !== emisorRuc);
	if (remaining.length === 0) {
		unlinkSync(file);
		return;
	}
	const text = remaining.map((q) => JSON.stringify(q)).join("\n");
	writePrivateFile(file, `${text}\n`);
}
