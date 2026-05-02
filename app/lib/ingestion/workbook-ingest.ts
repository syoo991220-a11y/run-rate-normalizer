import type { WorkBook } from "xlsx";

function stringifyCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

export type RawSheetTable = {
  /** Display names for each column (first row of sheet). */
  headers: string[];
  /** One object per data row; keys match `headers`. */
  rows: Record<string, string>[];
};

function uniquifyHeaders(cells: unknown[]): string[] {
  const baseCounts = new Map<string, number>();
  return cells.map((cell, idx) => {
    const raw = stringifyCell(cell);
    const base = raw || `Column ${idx + 1}`;
    const n = (baseCounts.get(base) ?? 0) + 1;
    baseCounts.set(base, n);
    if (n === 1) return base;
    return `${base} (${n})`;
  });
}

function workbookToRawSheetTable(xlsx: typeof import("xlsx"), wb: WorkBook): RawSheetTable {
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("Workbook has no sheets.");
  }
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new Error("Missing first worksheet.");
  }

  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  if (!aoa.length) {
    return { headers: [], rows: [] };
  }

  const headerCells = (aoa[0] as unknown[]) ?? [];
  const headers = uniquifyHeaders(headerCells);

  const rows: Record<string, string>[] = [];
  for (let r = 1; r < aoa.length; r++) {
    const line = (aoa[r] as unknown[]) ?? [];
    const o: Record<string, string> = {};
    let any = false;
    for (let c = 0; c < headers.length; c++) {
      const v = stringifyCell(line[c]);
      o[headers[c]!] = v;
      if (v !== "") any = true;
    }
    if (any) rows.push(o);
  }

  return { headers, rows };
}

/**
 * Parses workbook bytes with the same SheetJS path as {@link fileToRawSheetTable}
 * (CSV vs Excel is inferred from `fileName`). Loads `xlsx` on demand to reduce initial JS.
 */
export async function arrayBufferToRawSheetTable(
  arrayBuffer: ArrayBuffer,
  fileName: string,
): Promise<RawSheetTable> {
  const xlsx = await import("xlsx");
  const name = fileName.toLowerCase();
  const isCsv = name.endsWith(".csv");
  const wb = isCsv
    ? xlsx.read(new TextDecoder("utf-8").decode(new Uint8Array(arrayBuffer)), {
        type: "string",
        raw: false,
      })
    : xlsx.read(arrayBuffer, { type: "array", cellDates: false });
  return workbookToRawSheetTable(xlsx, wb);
}

/**
 * Reads the first worksheet as a raw table: first row = column headers,
 * following rows = data (no header name validation).
 */
export async function fileToRawSheetTable(file: File): Promise<RawSheetTable> {
  const xlsx = await import("xlsx");
  const name = file.name.toLowerCase();
  const isCsv = name.endsWith(".csv");

  const wb = isCsv
    ? xlsx.read(await file.text(), { type: "string", raw: false })
    : xlsx.read(await file.arrayBuffer(), { type: "array", cellDates: false });

  return workbookToRawSheetTable(xlsx, wb);
}

/** @deprecated Prefer fileToRawSheetTable + column mapping. */
export async function fileToJsonRows(file: File): Promise<Record<string, string>[]> {
  const { headers, rows } = await fileToRawSheetTable(file);
  if (!headers.length) return [];
  return rows;
}
