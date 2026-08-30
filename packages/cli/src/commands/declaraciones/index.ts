import { resolve } from "node:path";
import { Command } from "commander";
import { writePrivateOutputFile } from "../../data/private-storage.ts";
import {
	DeclaracionesInputError,
	formatFechaSunat,
	isPdf,
	normalizeFormulario,
	normalizePeriodo,
	validateRango,
} from "../../declaraciones/parse.ts";
import { DeclaracionesPortalError, openDeclaracionesPortal } from "../../declaraciones/portal.ts";
import type { ConstanciaResult, DeclaracionesListResult } from "../../declaraciones/types.ts";
import { output, outputError } from "../../utils/output.ts";
import { dim, ok } from "../../utils/style.ts";

export function saveConstancia(path: string, bytes: Uint8Array): void {
	writePrivateOutputFile(path, bytes);
}

function fail(error: unknown, format: "json" | "table" | "auto"): never {
	if (error instanceof DeclaracionesPortalError) {
		outputError(error.message, format, { code: error.code, hint: error.hint });
	}
	if (error instanceof DeclaracionesInputError) {
		outputError(error.message, format, { code: error.code, hint: error.hint });
	}
	outputError(error instanceof Error ? error.message : String(error), format);
	process.exit(1);
}

/** Default window: the last 90 days, well inside SUNAT's six-month cap. */
function defaultRange(): { desde: string; hasta: string } {
	const hasta = new Date();
	const desde = new Date(hasta);
	desde.setDate(desde.getDate() - 90);
	return { desde: formatFechaSunat(desde), hasta: formatFechaSunat(hasta) };
}

export function createDeclaracionesCommand(): Command {
	const declaraciones = new Command("declaraciones").description(
		"Read filed declarations and payments from SOL. Lists and downloads constancias; does not file, pay or amend.",
	);
	const format = (command: Command) => command.parent?.parent?.opts().output || "auto";

	declaraciones
		.command("list")
		.description("List declarations and NPS payments presented in a date range (max six months)")
		.option("--desde <DD/MM/YYYY>", "Start of the presentation-date range (default: 90 days ago)")
		.option("--hasta <DD/MM/YYYY>", "End of the presentation-date range (default: today)")
		.option("--formulario <code>", "Keep only this form, e.g. 0601, 0621, 1663 (client-side filter)")
		.option("--periodo <YYYYMM>", "Keep only this tax period, e.g. 202607 (client-side filter)")
		.action(async (options, command) => {
			const fmt = format(command);
			let portal: Awaited<ReturnType<typeof openDeclaracionesPortal>> | null = null;
			try {
				const defaults = defaultRange();
				const desde: string = options.desde ?? defaults.desde;
				const hasta: string = options.hasta ?? defaults.hasta;
				validateRango(desde, hasta);
				const formulario = options.formulario ? normalizeFormulario(options.formulario) : undefined;
				const periodo = options.periodo ? normalizePeriodo(options.periodo) : undefined;

				portal = await openDeclaracionesPortal();
				const rows = await portal.lista(desde, hasta);
				const items = rows.filter(
					(r) => (!formulario || r.formulario === formulario) && (!periodo || r.periodo === periodo),
				);
				const result: DeclaracionesListResult = {
					desde,
					hasta,
					filtros: { formulario, periodo },
					count: items.length,
					items,
				};
				output(fmt, {
					json: result,
					table: {
						headers: ["FECHA", "PERIODO", "FORM", "DESCRIPCIÓN", "N° ORDEN", "TIPO"],
						rows: items.map((r) => [
							r.fechaPresentacion,
							r.periodo,
							r.formulario,
							r.descripcion,
							r.numOrden,
							r.kind === "declaracion" ? ok("declaración") : dim("pago"),
						]),
					},
				});
			} catch (error) {
				await portal?.close();
				portal = null;
				fail(error, fmt);
			} finally {
				await portal?.close();
			}
		});

	declaraciones
		.command("constancia")
		.description("Download the constancia de presentación (PDF) of a filed declaration")
		.argument("<numOrden>", "Número de orden from 'declaraciones list'")
		.requiredOption("--formulario <code>", "Form code of that filing, e.g. 0601 or 0621")
		.option("--out <path>", "Where to write the PDF (default: constancia-<form>-<numOrden>.pdf)")
		.action(async (numOrden: string, options, command) => {
			const fmt = format(command);
			let portal: Awaited<ReturnType<typeof openDeclaracionesPortal>> | null = null;
			try {
				if (!/^\d+$/.test(numOrden)) {
					throw new DeclaracionesInputError("numOrden must be numeric.", "bad-num-orden");
				}
				const formulario = normalizeFormulario(options.formulario);
				const path = resolve(options.out ?? `constancia-${formulario}-${numOrden}.pdf`);

				portal = await openDeclaracionesPortal();
				const bytes = await portal.constancia(numOrden, formulario);
				if (!isPdf(bytes)) {
					throw new DeclaracionesPortalError("Downloaded bytes are not a PDF.", 502, "not-pdf");
				}
				saveConstancia(path, bytes);
				const result: ConstanciaResult = { numOrden, formulario, path, bytes: bytes.length };
				output(fmt, {
					json: result,
					table: {
						headers: ["PROPERTY", "VALUE"],
						rows: [
							["Formulario", formulario],
							["N° Orden", numOrden],
							["Saved", path],
							["Bytes", String(bytes.length)],
						],
					},
				});
			} catch (error) {
				await portal?.close();
				portal = null;
				fail(error, fmt);
			} finally {
				await portal?.close();
			}
		});

	return declaraciones;
}
