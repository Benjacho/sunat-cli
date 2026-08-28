import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	DeclaracionesInputError,
	formatFechaSunat,
	hasNoResultsNotice,
	isPdf,
	looksLikeLostSession,
	normalizeFormulario,
	normalizePeriodo,
	parseCodigoConstancia,
	parseFechaSunat,
	parseListaHtml,
	validateRango,
} from "../../src/declaraciones/parse.ts";
import {
	buildConstanciaExpression,
	buildListaBody,
	buildListaExpression,
	createDeclaracionesRequester,
	DeclaracionesPortalError,
	MENU_CODE,
	SERVLET_PATH,
} from "../../src/declaraciones/portal.ts";

const PORTAL_SOURCE = readFileSync(new URL("../../src/declaraciones/portal.ts", import.meta.url), "utf8");

// Shape of the results table as the visor rendered it on 2026-08-27 for a
// RUC 20 (identifiers replaced). Declarations link to constanciaNP, NPS
// boletas to comprobante, the header row has no anchor at all.
const LISTA_FIXTURE = `
<html><body>
<h3>Consulta de Declaraciones</h3>
<table>
<tr><th>Fec. Pres.</th><th>Periodo</th><th>Cod.Form.</th><th>Desc.Form.</th><th>N&deg; Orden</th><th>Detalle</th></tr>
<tr><td>1</td><td>27/08/2026</td><td>202607</td><td>0601</td><td>PLANILLA ELECTRONICA</td><td>1000000001</td>
<td><a href="javascript:constanciaNP(1000000001,'0601')">Comprobante</a></td></tr>
<tr><td>2</td><td>25/08/2026</td><td>202607</td><td>0621</td><td>PDT IGV-RENTA MENSUAL-IEV</td><td>1000000002</td>
<td><a href="javascript:constanciaNP(1000000002,'0621')">Comprobante</a></td></tr>
<tr><td>3</td><td>22/07/2026</td><td>202606</td><td>1663</td><td>BOLETA DE PAGO - NPS</td><td>200000001</td>
<td><a href="javascript:comprobante('1663',7000000001,'',200000001)">Comprobante</a></td></tr>
<tr><td>4</td><td>24/05/2026</td><td>202513</td><td>0710</td><td>RENTA ANUAL - EMPRESAS</td><td>1160000000</td>
<td><a href="javascript:comprobanteNSIR('X',9000000000,'0710',1160000000,'01','202513')">Comprobante</a></td></tr>
</table>
<form name="formPaginacion" method="post" action="ConsultaDeclaracion.jsp"><input name="tamanioPagina"><input name="pagina"></form>
</body></html>`;

describe("declaraciones parser", () => {
	test("reads declarations, payments and annual returns from the visor table", () => {
		const rows = parseListaHtml(LISTA_FIXTURE);
		expect(rows).toHaveLength(4);
		expect(rows[0]).toEqual({
			fechaPresentacion: "27/08/2026",
			periodo: "202607",
			formulario: "0601",
			descripcion: "PLANILLA ELECTRONICA",
			numOrden: "1000000001",
			kind: "declaracion",
		});
		expect(rows[1].formulario).toBe("0621");
		expect(rows[2]).toEqual({
			fechaPresentacion: "22/07/2026",
			periodo: "202606",
			formulario: "1663",
			descripcion: "BOLETA DE PAGO - NPS",
			numOrden: "200000001",
			kind: "pago",
			numPresentacion: "7000000001",
		});
		expect(rows[3]).toMatchObject({
			formulario: "0710",
			periodo: "202513",
			numOrden: "1160000000",
			kind: "declaracion",
		});
	});

	test("takes numOrden and codFor from the anchor, not from the cells", () => {
		const html = `<tr><td>1</td><td>01/02/2026</td><td>202601</td><td>0621</td><td>X</td><td>999</td>
<td><a href="javascript:constanciaNP(123456,'601')">Comprobante</a></td></tr>`;
		const [row] = parseListaHtml(html);
		expect(row.numOrden).toBe("123456");
		expect(row.formulario).toBe("0601");
	});

	test("ignores header, pagination and unrelated rows", () => {
		expect(parseListaHtml("<table><tr><th>Fec. Pres.</th></tr><tr><td>a</td><td>b</td></tr></table>")).toEqual([]);
	});

	test("detects the empty-range notice and a lost session", () => {
		expect(hasNoResultsNotice("<b>No se encontraron declaraciones para el rango de fechas indicado</b>")).toBe(true);
		expect(looksLikeLostSession('<input id="txtContrasena"><button>Iniciar sesión</button>')).toBe(true);
		expect(looksLikeLostSession(LISTA_FIXTURE)).toBe(false);
	});

	test("reads the ECM code and treats 0 as not yet available", () => {
		expect(
			parseCodigoConstancia('<?xml version="1.0"?>\n<codigo>{7000889F-0100-C08C-9C79-0471E5473FF2}</codigo>\n'),
		).toBe("{7000889F-0100-C08C-9C79-0471E5473FF2}");
		expect(parseCodigoConstancia("<codigo>0</codigo>")).toBeNull();
		expect(parseCodigoConstancia("<html>login</html>")).toBeNull();
	});

	test("recognizes a PDF by its magic bytes", () => {
		expect(isPdf(new TextEncoder().encode("%PDF-1.4\n%..."))).toBe(true);
		expect(isPdf(new TextEncoder().encode("<html>"))).toBe(false);
	});
});

describe("declaraciones input validation", () => {
	test("accepts SUNAT dates and rejects impossible ones", () => {
		expect(parseFechaSunat("27/08/2026")?.getDate()).toBe(27);
		expect(parseFechaSunat("31/02/2026")).toBeNull();
		expect(parseFechaSunat("2026-08-27")).toBeNull();
		expect(formatFechaSunat(new Date(2026, 7, 5))).toBe("05/08/2026");
	});

	test("enforces the six-month window the visor imposes", () => {
		expect(() => validateRango("01/06/2026", "27/08/2026")).not.toThrow();
		expect(() => validateRango("01/01/2026", "27/08/2026")).toThrow(DeclaracionesInputError);
		expect(() => validateRango("27/08/2026", "01/06/2026")).toThrow(/after/);
		expect(() => validateRango("2026-06-01", "27/08/2026")).toThrow(/DD\/MM\/YYYY/);
	});

	test("pads form codes and validates periods", () => {
		expect(normalizeFormulario("601")).toBe("0601");
		expect(normalizeFormulario("1663")).toBe("1663");
		expect(() => normalizeFormulario("61")).toThrow(DeclaracionesInputError);
		expect(normalizePeriodo("202607")).toBe("202607");
		expect(normalizePeriodo("202513")).toBe("202513");
		expect(() => normalizePeriodo("2026-07")).toThrow(DeclaracionesInputError);
		expect(() => normalizePeriodo("202614")).toThrow(DeclaracionesInputError);
	});
});

describe("declaraciones portal boundary", () => {
	test("the list body is exactly the visor's own form", () => {
		const body = buildListaBody("01/06/2026", "27/08/2026");
		expect(body).toBe(
			"accion=lista&num_pres=&cod_for=&num_ord=&fechaDesde=01%2F06%2F2026&fechaHasta=27%2F08%2F2026&B1=Buscar",
		);
	});

	test("the in-page expressions only read and never touch cookies or the filing actions", () => {
		const lista = buildListaExpression("01/06/2026", "27/08/2026");
		const constancia = buildConstanciaExpression("1000000001", "0601");
		for (const expression of [lista, constancia]) {
			expect(expression).toContain(SERVLET_PATH);
			expect(expression).toContain("credentials:'include'");
			expect(expression).not.toContain("document.cookie");
			expect(expression).not.toContain("location.search");
			expect(expression).not.toMatch(/presentar|pagar|rectific|hojaReliquidacion|ComprobanteCons/i);
		}
		expect(lista).toContain("accion=lista");
		expect(constancia).toContain("accion=validar_constanciaNP&num_ord=1000000001&cod_for=0601");
		expect(constancia).toContain("accion=obtener_constanciaNP&cod_ecm=");
	});

	test("opens the visor through the menu hop, never the servlet URL cold", () => {
		expect(MENU_CODE).toBe("12.1.1.1.4");
		expect(PORTAL_SOURCE).toContain("nivel4_12_1_1_1_4");
		expect(PORTAL_SOURCE).toContain('origin: "ww1.sunat.gob.pe"');
		expect(PORTAL_SOURCE).not.toContain(`browser.open("https://ww1.sunat.gob.pe`);
		const open = PORTAL_SOURCE.indexOf("export async function openDeclaracionesPortal");
		const failure = PORTAL_SOURCE.indexOf("} catch (error) {", open);
		expect(PORTAL_SOURCE.indexOf("await browser.close()", failure)).toBeGreaterThan(failure);
	});

	test("serializes requests with the pacing gap and surfaces eval failures", async () => {
		const calls: string[] = [];
		const sleeps: number[] = [];
		const requester = createDeclaracionesRequester(
			{
				evalIn: async (expression) => {
					calls.push(expression);
					return { val: JSON.stringify({ ok: true, status: 200, html: "" }) };
				},
			},
			{ sleep: async (ms) => void sleeps.push(ms), now: () => 10_000 },
		);
		await Promise.all([requester("/first"), requester("/second")]);
		expect(calls).toEqual(["/first", "/second"]);
		expect(sleeps).toEqual([1200]);

		const failing = createDeclaracionesRequester({ evalIn: async () => ({ err: "boom" }) }, { sleep: async () => {} });
		await expect(failing("/x")).rejects.toBeInstanceOf(DeclaracionesPortalError);
		const garbage = createDeclaracionesRequester({ evalIn: async () => ({ val: 42 }) }, { sleep: async () => {} });
		await expect(garbage("/x")).rejects.toMatchObject({ code: "bad-response" });
	});
});
