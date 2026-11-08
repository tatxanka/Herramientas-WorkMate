"""Independent exact CSV comparison and optional verification of both exports."""

import argparse
import csv
import json
import unicodedata
from collections import Counter
from contextlib import ExitStack
from pathlib import Path


# ECMAScript's String.trim whitespace, including BOM and excluding NEL.
TRIM = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
END = object()


def normalize(value, args):
    if args.trim:
        value = value.strip(TRIM)
    if args.ignore_case:
        value = value.lower()
    if args.ignore_accents:
        value = "".join(c for c in unicodedata.normalize("NFD", value)
                        if not unicodedata.category(c).startswith("M"))
    return value


def open_csv(stack, path, separator):
    stream = stack.enter_context(path.open(encoding="utf-8-sig", newline=""))
    reader = csv.reader(stream, delimiter=separator, strict=True)
    header = next(reader, None)
    if header is None:
        raise ValueError("Falta la cabecera de uno de los CSV.")
    if not header:
        header = [""]

    def rows():
        for number, row in enumerate(reader, 2):
            # A blank physical record is a single empty cell in CSV MATCH.
            if not row and len(header) == 1:
                row = [""]
            if len(row) != len(header):
                raise ValueError(f"El registro {number} de uno de los CSV tiene un ancho incorrecto.")
            yield row

    return header, rows()


def column(header, position):
    if not 1 <= position <= len(header):
        raise ValueError(f"La columna {position} no existe en el archivo.")
    return position - 1


def audit(args):
    csv.field_size_limit(8 * 1024 * 1024)
    with ExitStack() as stack:
        source_header, source_rows = open_csv(stack, args.source, args.source_separator)
        target_header, target_rows = open_csv(stack, args.target, args.target_separator)
        source_column = column(source_header, args.source_column)
        target_columns = tuple(dict.fromkeys(column(target_header, pos) for pos in args.target_columns))
        lookup = set()
        target_count = 0
        for row in target_rows:
            target_count += 1
            for index in target_columns:
                key = normalize(row[index], args)
                if key:
                    lookup.add(key)

        exports = None
        if args.matched:
            exports = {}
            for side, path in [(True, args.matched), (False, args.unmatched)]:
                header, rows = open_csv(stack, path, args.export_separator)
                if header != source_header:
                    raise ValueError("Una exportación no conserva la cabecera del origen.")
                exports[side] = rows

        log = None
        if args.local_diagnostics:
            path = args.local_diagnostics.resolve()
            if any((parent / ".git").exists() for parent in path.parents):
                raise ValueError("Guarda el diagnóstico fuera de cualquier repositorio Git.")
            log = stack.enter_context(path.open("x", encoding="utf-8"))

        counts = Counter()
        examples = 0

        def report(kind, position, expected=END, observed=END):
            nonlocal examples
            counts[kind] += 1
            if log and examples < 25:
                details = {"motivo": kind, "registro_origen": position}
                for label, row in [("esperado", expected), ("observado", observed)]:
                    if row is not END:
                        value = row[source_column]
                        details[label] = value
                        details[label + "_escapado"] = ascii(value)
                print(json.dumps(details, ensure_ascii=True), file=log)
                examples += 1

        def is_match(row):
            return normalize(row[source_column], args) in lookup

        def verify_side(side, observed, position):
            if observed is not END and is_match(observed) != side:
                report("falso_positivo" if side else "falso_negativo", position, observed=observed)

        found = missing = 0
        for position, row in enumerate(source_rows, 2):
            side = is_match(row)
            found += side
            missing += not side
            if exports:
                observed = next(exports[side], END)
                verify_side(side, observed, position)
                if observed != row:
                    report("fila_ausente" if observed is END else "fila_o_orden_distinto", position, row, observed)
        if exports:
            for side, rows in exports.items():
                for observed in rows:
                    verify_side(side, observed, None)
                    report("fila_sobrante", None, observed=observed)

        return {"total_origen": found + missing, "total_destino": target_count,
                "coinciden": found, "no_coinciden": missing,
                "columnas_destino": [i + 1 for i in target_columns],
                "exportaciones_verificadas": bool(exports) and not counts,
                "discrepancias": dict(counts)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--source-column", type=int, required=True, help="Posición desde 1")
    parser.add_argument("--target-columns", nargs="+", type=int, required=True, help="Posiciones desde 1")
    parser.add_argument("--source-separator", choices=[",", ";"], default=",")
    parser.add_argument("--target-separator", choices=[",", ";"], default=",")
    parser.add_argument("--export-separator", choices=[",", ";"], default=",")
    parser.add_argument("--ignore-case", action="store_true")
    parser.add_argument("--ignore-accents", action="store_true")
    parser.add_argument("--trim", action="store_true")
    parser.add_argument("--matched", type=Path)
    parser.add_argument("--unmatched", type=Path)
    parser.add_argument("--local-diagnostics", type=Path, help="Archivo nuevo fuera de Git para ejemplos con valores originales")
    args = parser.parse_args()
    if bool(args.matched) != bool(args.unmatched):
        parser.error("Indica ambas exportaciones o ninguna.")
    if args.local_diagnostics and not args.matched:
        parser.error("El diagnóstico requiere ambas exportaciones.")
    try:
        result = audit(args)
    except (OSError, UnicodeError, ValueError, csv.Error) as error:
        parser.exit(2, f"No se pudo completar la auditoría. {error}\n")
    print(json.dumps(result, ensure_ascii=True))
    return 1 if result["discrepancias"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
