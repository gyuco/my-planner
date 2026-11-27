import { PrismaD1 } from "@prisma/adapter-d1";

/**
 * Workaround per un bug di @prisma/adapter-d1 (5.22): l'adapter deduce il
 * tipo delle colonne dal primo valore non nullo e considera "DateTime" ogni
 * stringa che *contiene* un timestamp ISO, perche' la sua regex non e'
 * ancorata (`^(a)|(b)|(c)$`). Un testo come una descrizione che cita
 * "2026-11-28T01:00:00Z" fa quindi fallire la query con
 * "Inconsistent column data: Conversion failed: expected a datetime string".
 *
 * Qui ricontrolliamo le colonne marcate DateTime con una regex ancorata su
 * tutti i valori: se anche uno solo non e' una data vera, la colonna torna Text.
 */

// ColumnTypeEnum di @prisma/driver-adapter-utils
const COLUMN_TYPE_TEXT = 7;
const COLUMN_TYPE_DATETIME = 10;

const ISO_DATE = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d(:[0-5]\d(\.\d+)?)?([+-][0-2]\d:[0-5]\d|Z)$/;
const SQLITE_DATE = /^\d{4}-[0-1]\d-[0-3]\d [0-2]\d:[0-5]\d:[0-5]\d$/;

export function isRealDate(value: unknown): boolean {
  return typeof value === "string" && (ISO_DATE.test(value) || SQLITE_DATE.test(value));
}

interface ConvertedResult {
  columnNames: string[];
  columnTypes: number[];
  rows: unknown[][];
}

export function fixDateColumnTypes<T extends ConvertedResult>(result: T): T {
  result.columnTypes.forEach((type, i) => {
    if (type !== COLUMN_TYPE_DATETIME) return;
    const allDates = result.rows.every((row) => row[i] === null || isRealDate(row[i]));
    if (!allDates) result.columnTypes[i] = COLUMN_TYPE_TEXT;
  });
  return result;
}

let patched = false;

/** Applica la correzione (una sola volta) a PrismaD1 e alle sue transazioni. */
export function patchD1DateInference(): void {
  if (patched) return;
  // convertData e' definito sulla classe base condivisa da PrismaD1 e D1Transaction.
  const base = Object.getPrototypeOf(PrismaD1.prototype) as {
    convertData?: (io: unknown) => ConvertedResult;
  };
  const original = base.convertData;
  if (typeof original !== "function") return;
  base.convertData = function (this: unknown, io: unknown) {
    return fixDateColumnTypes(original.call(this, io));
  };
  patched = true;
}
