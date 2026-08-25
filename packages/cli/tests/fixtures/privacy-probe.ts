import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { audit, auditReference } from "../../src/data/audit.ts";
import { ensureDirs, loadConfig, paths, saveConfig } from "../../src/data/config.ts";
import { secureExistingFile, writePrivateOutputFile } from "../../src/data/private-storage.ts";

const action = process.argv[2];

if (action === "permissions") {
	saveConfig({ ruc: "20123456789", usuario: "USER" });
	auditReference("permission-check");
	audit({ command: "test", args: {}, result: "success" });
	const auditFile = `${paths.auditDir}/${new Date().toISOString().slice(0, 7)}.jsonl`;
	console.log(
		JSON.stringify({
			dir: statSync(paths.sunatDir).mode & 0o777,
			config: statSync(paths.config).mode & 0o777,
			audit: statSync(auditFile).mode & 0o777,
			key: statSync(`${paths.sunatDir}/audit.key`).mode & 0o777,
			marker: statSync(`${paths.sunatDir}/audit-privacy-v1`).mode & 0o777,
		}),
	);
} else if (action === "repair") {
	ensureDirs();
	writeFileSync(paths.config, '{"usuario":"USER","apiClientSecret":"legacy-secret","futurePii":"private person"}', {
		mode: 0o644,
	});
	chmodSync(paths.config, 0o644);
	const config = loadConfig();
	console.log(
		JSON.stringify({
			mode: statSync(paths.config).mode & 0o777,
			config,
			stored: readFileSync(paths.config, "utf8"),
		}),
	);
} else if (action === "redaction") {
	audit({
		command: "cpe factura emit",
		result: "success",
		args: {
			receptor: { numDoc: "20123456789", rznSocial: "PRIVATE CLIENT SAC" },
			items: [{ descripcion: "Private consulting" }],
			password: "super-secret",
			unexpectedField: "Future customer alias",
		},
		details: {
			xml: "<Invoice>PRIVATE CLIENT SAC</Invoice>",
			error: "SUNAT rejected DNI 12345678 for private@example.com",
			status: "accepted",
		},
	});
	const file = `${paths.auditDir}/${new Date().toISOString().slice(0, 7)}.jsonl`;
	console.log(readFileSync(file, "utf8"));
} else if (action === "migrate") {
	ensureDirs();
	mkdirSync(`${paths.auditDir}/archive`, { recursive: true });
	const activeMonth = new Date().toISOString().slice(0, 7);
	const legacy = `${JSON.stringify({
		timestamp: `${activeMonth}-01T00:00:00.000Z`,
		command: "cpe factura emit",
		args: { futureAlias: "PRIVATE CLIENT SAC", receptor: { numDoc: "20123456789" } },
		result: "success",
		details: { id: "20123456789-01-F001-1", emisorRuc: "20123456789", xml: "<Invoice/>" },
	})}\n`;
	writeFileSync(`${paths.auditDir}/${activeMonth}.jsonl`, legacy, { mode: 0o644 });
	writeFileSync(`${paths.auditDir}/archive/2025-12.jsonl.gz`, gzipSync(legacy), { mode: 0o644 });
	mkdirSync(`${paths.auditDir}/screenshots`, { recursive: true });
	writeFileSync(`${paths.auditDir}/screenshots/rhe-result.png`, "legacy tax portal image");
	auditReference("trigger-migration");
	const { sanitizeExistingAuditLogs } = await import("../../src/data/audit.ts");
	sanitizeExistingAuditLogs();
	console.log(
		JSON.stringify({
			active: readFileSync(`${paths.auditDir}/${activeMonth}.jsonl`, "utf8"),
			archive: gunzipSync(readFileSync(`${paths.auditDir}/archive/2025-12.jsonl.gz`)).toString(),
			activeMode: statSync(`${paths.auditDir}/${activeMonth}.jsonl`).mode & 0o777,
			archiveMode: statSync(`${paths.auditDir}/archive/2025-12.jsonl.gz`).mode & 0o777,
			screenshotExists: existsSync(`${paths.auditDir}/screenshots/rhe-result.png`),
		}),
	);
} else if (action === "migrate-after-marker") {
	ensureDirs();
	audit({ command: "test", args: {}, result: "success" });
	const activeMonth = new Date().toISOString().slice(0, 7);
	const unsafe = `${JSON.stringify({
		timestamp: `${activeMonth}-01T00:00:00.000Z`,
		command: "cpe factura emit",
		args: { receptor: "PRIVATE CLIENT SAC" },
		result: "success",
	})}\n`;
	await Bun.sleep(20);
	writeFileSync(`${paths.auditDir}/${activeMonth}.jsonl`, unsafe, { mode: 0o644 });
	mkdirSync(`${paths.auditDir}/screenshots`, { recursive: true });
	writeFileSync(`${paths.auditDir}/screenshots/legacy.png`, "private portal image");
	const { sanitizeExistingAuditLogs } = await import("../../src/data/audit.ts");
	sanitizeExistingAuditLogs();
	console.log(
		JSON.stringify({
			active: readFileSync(`${paths.auditDir}/${activeMonth}.jsonl`, "utf8"),
			screenshotExists: existsSync(`${paths.auditDir}/screenshots/legacy.png`),
		}),
	);
} else if (action === "output-permissions") {
	const outputDir = `${process.env.HOME}/exports`;
	mkdirSync(outputDir, { mode: 0o755 });
	writePrivateOutputFile(`${outputDir}/sire.zip`, "private tax export");
	console.log(
		JSON.stringify({
			dir: statSync(outputDir).mode & 0o777,
			file: statSync(`${outputDir}/sire.zip`).mode & 0o777,
		}),
	);
} else if (action === "acl") {
	ensureDirs();
	writeFileSync(paths.config, '{"usuario":"USER"}', { mode: 0o600 });
	if (process.platform === "darwin") {
		const added = spawnSync("/bin/chmod", ["+a", "everyone allow read", paths.config]);
		if (added.status !== 0) throw new Error("Could not add test ACL");
	}
	secureExistingFile(paths.config);
	const acl = spawnSync("/bin/ls", ["-le", paths.config], { encoding: "utf8" });
	console.log(JSON.stringify({ hasEveryoneAcl: /^\s*\d+: everyone /m.test(acl.stdout) }));
} else if (action === "reference") {
	console.log(
		JSON.stringify({
			first: auditReference("20123456789-01-F001-1"),
			second: auditReference("20123456789-01-F001-1"),
		}),
	);
} else {
	throw new Error(`Unknown action: ${action}`);
}
