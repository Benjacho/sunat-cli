import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { paths } from "./config.ts";
import { appendPrivateFile, ensurePrivateDir, secureExistingFile, writePrivateFile } from "./private-storage.ts";

export interface AuditEntry {
	timestamp: string;
	command: string;
	args: Record<string, unknown>;
	result: "success" | "error" | "dry-run" | "pending";
	details?: Record<string, unknown>;
	durationMs?: number;
}

export interface AuditCompactResult {
	compactedMonths: string[];
	compactedFiles: string[];
	archivePaths: string[];
	skippedMonths: string[];
}

export interface AuditPruneResult {
	prunedMonths: string[];
	prunedPaths: string[];
}

export interface AuditListOptions {
	ruc?: string;
	limit?: number;
}

const MONTHLY_AUDIT_FILE = /^(\d{4}-\d{2})\.jsonl$/;
const LEGACY_DAILY_AUDIT_FILE = /^(\d{4}-\d{2})-\d{2}\.jsonl$/;
const ARCHIVED_AUDIT_FILE = /^(\d{4}-\d{2})\.jsonl\.gz$/;
const AUDIT_KEY_FILE = join(paths.sunatDir, "audit.key");
const AUDIT_PRIVACY_MARKER = join(paths.sunatDir, "audit-privacy-v1");
const LEGACY_SCREENSHOT_DIR = join(paths.auditDir, "screenshots");
const SAFE_DETAIL_ENUMS: Record<string, ReadonlySet<string>> = {
	stage: new Set(["pre-submit"]),
	status: new Set(["submitted", "accepted", "rejected", "pending", "processing", "completed"]),
	state: new Set(["submitted", "accepted", "rejected", "pending", "processing", "completed"]),
};
const SAFE_DETAIL_NUMBERS = new Set(["durationMs", "zipSize", "entries", "bytesSent", "filas", "count"]);
const SAFE_DETAIL_BOOLEANS = new Set(["ok", "success", "authenticated"]);
const SAFE_RESULTS = new Set(["success", "error", "dry-run", "pending"]);
const SAFE_COMMANDS = new Set([
	"cpe baja send",
	"cpe boleta emit",
	"cpe boleta queue",
	"cpe factura emit",
	"cpe factura preview",
	"cpe gre emit",
	"cpe nc emit",
	"cpe nd emit",
	"cpe resumen send",
	"f616 declare",
	"f616 declarar bandeja",
	"f616 declarar ingreso",
	"login",
	"padron sync",
	"rhe emit",
	"sire compras importar",
	"sire compras propuesta",
	"sire compras reemplazar",
	"sire ventas aceptar",
	"sire ventas importar",
	"sire ventas propuesta",
	"sire ventas reemplazar",
	"tipo-cambio",
]);

export const DEFAULT_AUTO_COMPACT_AFTER_MONTHS = 6;
export const DEFAULT_RECOMMENDED_ARCHIVE_MONTHS = 24;

function ensureAuditDir(): void {
	ensurePrivateDir(paths.auditDir);
}

function ensureAuditArchiveDir(): string {
	const dir = join(paths.auditDir, "archive");
	ensurePrivateDir(dir);
	return dir;
}

function auditKey(): Buffer {
	ensurePrivateDir(paths.sunatDir);
	if (!existsSync(AUDIT_KEY_FILE)) writePrivateFile(AUDIT_KEY_FILE, randomBytes(32));
	secureExistingFile(AUDIT_KEY_FILE);
	return readFileSync(AUDIT_KEY_FILE);
}

export function auditReference(value: unknown): string {
	return `hmac-sha256:${createHmac("sha256", auditKey()).update(String(value)).digest("hex")}`;
}

function safeDetailValue(key: string, value: unknown): unknown {
	if ((key === "idRef" || key === "emisorRef") && typeof value === "string") {
		return /^hmac-sha256:[a-f0-9]{64}$/.test(value) ? value : undefined;
	}
	if (key === "hash" && typeof value === "string") {
		return /^(?:sha256:)?[a-f0-9]{32,128}$/i.test(value) ? value : undefined;
	}
	if (key === "cdrCode" && typeof value === "string") {
		return /^[A-Za-z0-9_-]{1,20}$/.test(value) ? value : undefined;
	}
	if (SAFE_DETAIL_ENUMS[key]?.has(String(value))) return value;
	if (SAFE_DETAIL_NUMBERS.has(key) && typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
	if (SAFE_DETAIL_BOOLEANS.has(key) && typeof value === "boolean") return value;
	return undefined;
}

export function sanitizeAuditEntry(entry: Omit<AuditEntry, "timestamp">): Omit<AuditEntry, "timestamp"> {
	const legacyDetails = entry.details || {};
	const details = {
		...legacyDetails,
		...(typeof legacyDetails.id === "string" ? { idRef: auditReference(legacyDetails.id) } : {}),
		...(typeof legacyDetails.emisorRuc === "string" ? { emisorRef: auditReference(legacyDetails.emisorRuc) } : {}),
	};
	const safeDetails = Object.fromEntries(
		Object.entries(details)
			.map(([key, value]) => [key, safeDetailValue(key, value)])
			.filter(([, value]) => value !== undefined),
	);
	return {
		command: SAFE_COMMANDS.has(entry.command) ? entry.command : "unknown",
		result: SAFE_RESULTS.has(entry.result) ? entry.result : "error",
		args: {},
		...(Object.keys(safeDetails).length > 0 ? { details: safeDetails } : {}),
		...(typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs) && entry.durationMs >= 0
			? { durationMs: entry.durationMs }
			: {}),
	};
}

function sanitizeStoredAudit(content: string): string {
	const sanitized: string[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as AuditEntry;
			if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(entry.timestamp)) continue;
			if (!entry.command || !SAFE_RESULTS.has(entry.result)) continue;
			sanitized.push(JSON.stringify({ timestamp: entry.timestamp, ...sanitizeAuditEntry(entry) }));
		} catch {}
	}
	return sanitized.length > 0 ? `${sanitized.join("\n")}\n` : "";
}

function monthKey(date: Date): string {
	return date.toISOString().slice(0, 7);
}

function parseMonth(month: string): { year: number; month: number } {
	const match = /^(\d{4})-(\d{2})$/.exec(month);
	if (!match) throw new Error(`Invalid month: "${month}". Expected YYYY-MM`);
	const year = Number(match[1]);
	const monthNumber = Number(match[2]);
	if (monthNumber < 1 || monthNumber > 12) throw new Error(`Invalid month: "${month}". Expected YYYY-MM`);
	return { year, month: monthNumber };
}

function monthDiff(currentMonth: string, candidateMonth: string): number {
	const current = parseMonth(currentMonth);
	const candidate = parseMonth(candidateMonth);
	return (current.year - candidate.year) * 12 + (current.month - candidate.month);
}

function auditFileNameForDate(date: Date): string {
	return `${monthKey(date)}.jsonl`;
}

function auditArchivePath(month: string): string {
	return join(ensureAuditArchiveDir(), `${month}.jsonl.gz`);
}

function readArchive(month: string): string {
	const archivePath = auditArchivePath(month);
	if (!existsSync(archivePath)) return "";
	secureExistingFile(archivePath);
	return gunzipSync(readFileSync(archivePath)).toString("utf-8");
}

function readAuditFile(path: string): string {
	if (!existsSync(path)) return "";
	secureExistingFile(path);
	return readFileSync(path, "utf-8");
}

function listAuditDirFiles(): string[] {
	ensureAuditDir();
	return readdirSync(paths.auditDir).sort();
}

function resolveMonthFromFile(file: string): string | null {
	const monthly = MONTHLY_AUDIT_FILE.exec(file);
	if (monthly) return monthly[1];
	const legacy = LEGACY_DAILY_AUDIT_FILE.exec(file);
	if (legacy) return legacy[1];
	return null;
}

export function listActiveAuditFiles(): string[] {
	return listAuditDirFiles().filter((file) => resolveMonthFromFile(file) !== null);
}

export function listArchivedAuditMonths(): string[] {
	const archiveDir = ensureAuditArchiveDir();
	return readdirSync(archiveDir)
		.map((file) => ARCHIVED_AUDIT_FILE.exec(file)?.[1] || null)
		.filter((month): month is string => month !== null)
		.sort();
}

export function archivedAuditRecoveryPath(month: string): string {
	return auditArchivePath(month);
}

let autoCompacted = false;

function maybeAutoCompact(): void {
	if (autoCompacted) return;
	autoCompacted = true;
	sanitizeExistingAuditLogs();
	compactAuditLogs({ olderThanMonths: DEFAULT_AUTO_COMPACT_AFTER_MONTHS });
}

export function sanitizeExistingAuditLogs(): void {
	ensureAuditDir();
	if (existsSync(LEGACY_SCREENSHOT_DIR)) rmSync(LEGACY_SCREENSHOT_DIR, { recursive: true, force: true });
	const activeFiles = listActiveAuditFiles();
	const archiveDir = ensureAuditArchiveDir();
	const archivedFiles = readdirSync(archiveDir).filter((file) => ARCHIVED_AUDIT_FILE.test(file));
	if (existsSync(AUDIT_PRIVACY_MARKER)) {
		secureExistingFile(AUDIT_PRIVACY_MARKER);
		const markerTime = statSync(AUDIT_PRIVACY_MARKER).mtimeMs;
		const legacyChanged = [
			...activeFiles.map((file) => join(paths.auditDir, file)),
			...archivedFiles.map((file) => join(archiveDir, file)),
		].some((path) => statSync(path).mtimeMs > markerTime);
		if (!legacyChanged) return;
	}
	for (const file of activeFiles) {
		const path = join(paths.auditDir, file);
		writePrivateFile(path, sanitizeStoredAudit(readAuditFile(path)));
	}
	for (const file of archivedFiles) {
		const path = join(archiveDir, file);
		secureExistingFile(path);
		const content = gunzipSync(readFileSync(path)).toString("utf-8");
		writePrivateFile(path, gzipSync(sanitizeStoredAudit(content)));
	}
	writePrivateFile(AUDIT_PRIVACY_MARKER, "1\n");
}

export function audit(entry: Omit<AuditEntry, "timestamp">): void {
	ensureAuditDir();
	maybeAutoCompact();
	const file = join(paths.auditDir, auditFileNameForDate(new Date()));
	const full: AuditEntry = { timestamp: new Date().toISOString(), ...sanitizeAuditEntry(entry) };
	appendPrivateFile(file, `${JSON.stringify(full)}\n`);
}

export function* iterateActiveAuditEntries(): Generator<AuditEntry> {
	maybeAutoCompact();
	for (const file of listActiveAuditFiles()) {
		const path = join(paths.auditDir, file);
		const content = readAuditFile(path);
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				yield JSON.parse(line) as AuditEntry;
			} catch {}
		}
	}
}

export function listAuditEntries(options: AuditListOptions = {}): AuditEntry[] {
	const entries = [...iterateActiveAuditEntries()];
	const expectedRef = options.ruc ? auditReference(options.ruc) : undefined;
	const filtered = options.ruc ? entries.filter((entry) => entry.details?.emisorRef === expectedRef) : entries;
	const sorted = filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	return options.limit === undefined ? sorted : sorted.slice(0, options.limit);
}

export function auditEntryEmisorReference(entry: AuditEntry): string | undefined {
	const reference = entry.details?.emisorRef;
	return typeof reference === "string" ? reference : undefined;
}

export function compactAuditLogs(options: { olderThanMonths?: number; now?: Date } = {}): AuditCompactResult {
	ensureAuditDir();
	sanitizeExistingAuditLogs();
	const olderThanMonths = options.olderThanMonths ?? DEFAULT_AUTO_COMPACT_AFTER_MONTHS;
	const nowMonth = monthKey(options.now ?? new Date());
	const filesByMonth = new Map<string, string[]>();

	for (const file of listActiveAuditFiles()) {
		const month = resolveMonthFromFile(file);
		if (!month) continue;
		const bucket = filesByMonth.get(month) || [];
		bucket.push(file);
		filesByMonth.set(month, bucket);
	}

	const compactedMonths: string[] = [];
	const compactedFiles: string[] = [];
	const archivePaths: string[] = [];
	const skippedMonths: string[] = [];

	for (const [month, files] of [...filesByMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		if (monthDiff(nowMonth, month) < olderThanMonths) {
			skippedMonths.push(month);
			continue;
		}

		const merged = [readArchive(month), ...files.map((file) => readAuditFile(join(paths.auditDir, file)))]
			.filter((chunk) => chunk.trim().length > 0)
			.join("")
			.replace(/\n*$/, "\n");

		if (!merged.trim()) {
			for (const file of files) rmSync(join(paths.auditDir, file), { force: true });
			compactedMonths.push(month);
			compactedFiles.push(...files.map((file) => join(paths.auditDir, file)));
			archivePaths.push(auditArchivePath(month));
			continue;
		}

		const archivePath = auditArchivePath(month);
		writePrivateFile(archivePath, gzipSync(merged));
		for (const file of files) rmSync(join(paths.auditDir, file), { force: true });

		compactedMonths.push(month);
		compactedFiles.push(...files.map((file) => join(paths.auditDir, file)));
		archivePaths.push(archivePath);
	}

	return { compactedMonths, compactedFiles, archivePaths, skippedMonths };
}

export function pruneArchivedAuditLogs(beforeMonth: string): AuditPruneResult {
	parseMonth(beforeMonth);
	const prunedMonths: string[] = [];
	const prunedPaths: string[] = [];
	const archiveDir = ensureAuditArchiveDir();

	for (const file of readdirSync(archiveDir).sort()) {
		const match = ARCHIVED_AUDIT_FILE.exec(file);
		if (!match) continue;
		const month = match[1];
		if (month >= beforeMonth) continue;
		const path = join(archiveDir, file);
		rmSync(path, { force: true });
		prunedMonths.push(month);
		prunedPaths.push(path);
	}

	return { prunedMonths, prunedPaths };
}
