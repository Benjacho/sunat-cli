/**
 * "Consulta de declaraciones juradas y pagos" — SOL viejo, menu code 12.1.1.1.4.
 *
 * The visor lists everything the taxpayer has filed or paid in a date range:
 * monthly returns (0621), planilla (0601), annual returns (0709/0710) and the
 * NPS payment slips (1663) that settle them. Each row links either to a
 * constancia de presentación (declarations) or to a payment detail (boletas).
 * Measured against production 2026-08-27 with a RUC 20; see
 * `src/skills/endpoints.md` for the request shapes.
 */

export type DeclaracionKind = "declaracion" | "pago";

export interface DeclaracionRow {
	/** Presentation (or payment) date exactly as SUNAT prints it: DD/MM/YYYY. */
	fechaPresentacion: string;
	/** Tax period as SUNAT prints it: YYYYMM. Annual returns use YYYY13. */
	periodo: string;
	/** Form code with its leading zero: 0601, 0621, 0710, 1663. */
	formulario: string;
	/** SUNAT's own label for the form, e.g. "PLANILLA ELECTRONICA". */
	descripcion: string;
	/** Número de orden: the identifier printed on the constancia. */
	numOrden: string;
	/**
	 * `declaracion` rows link to `constanciaNP(numOrden, codFor)`; `pago` rows
	 * (boletas 1663) link to `comprobante(codFor, numPres, '', numOrden)`.
	 */
	kind: DeclaracionKind;
	/** Only on `pago` rows: the presentation number the boleta settles. */
	numPresentacion?: string;
}

export interface DeclaracionesListResult {
	/** Range actually sent to SUNAT, DD/MM/YYYY. */
	desde: string;
	hasta: string;
	/** Client-side filters applied after the fetch, if any. */
	filtros: { formulario?: string; periodo?: string };
	count: number;
	items: DeclaracionRow[];
}

export interface ConstanciaResult {
	numOrden: string;
	formulario: string;
	path: string;
	bytes: number;
}
