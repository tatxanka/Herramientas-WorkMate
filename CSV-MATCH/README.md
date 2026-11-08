# CSV MATCH

Abre `index.html` en un navegador de escritorio. La aplicación procesa archivos locales y funciona sin servidor, red ni instalación. Conserva `index.html`, `js/` y `css/` juntos al copiarla.

- **Comparar archivos.** Carga dos archivos CSV o XLSX, elige una columna del origen y una o más del segundo archivo. Una coincidencia en cualquiera de las columnas seleccionadas basta para clasificar la fila de origen. Los valores vacíos no coinciden y las filas repetidas se clasifican por separado. Elige coincidencia exacta o parcial y descarga `COINCIDEN.csv` y `NO_COINCIDEN.csv`. El indicador `+N` muestra todas las columnas seleccionadas al pasar el puntero por el selector.
- **Buscar texto.** Carga uno o dos archivos, escribe el texto y selecciona el alcance y las columnas. La aplicación muestra hasta diez coincidencias por archivo. Cada descarga incluye todas las coincidencias del archivo correspondiente.
- Los selectores distinguen encabezados iguales mediante su posición. La vista previa está limitada a diez registros y abrevia las celdas largas. El total aparece cuando termina la lectura completa. Las operaciones validan el CSV entero y señalan el registro con errores de estructura.

## Procesamiento y exportación

- **CSV.** Lectura incremental en bloques de 256 KiB con decodificación UTF-8 estricta. El separador se detecta con la cabecera y hasta cinco registros adicionales. Si ambos formatos encajan, se elige la coma. Se admiten BOM, LF y CRLF, comillas escapadas, saltos interiores y campos vacíos.
- **XLSX.** Se usa la primera hoja del libro y se indica su nombre en la ficha del archivo. La primera fila del rango de datos es la cabecera. Las celdas de texto se conservan literalmente. Para números con formato General o mostrados en notación científica, se usa el valor numérico almacenado para evitar redondeos de presentación. Los formatos como `000000` conservan su relleno de ceros. Las fórmulas usan el resultado guardado. Si Excel perdió dígitos al almacenar un identificador como número, el lector solo puede recuperar el valor almacenado. Se admiten libros de hasta 16 MiB, con un máximo de 64 MiB de contenido descomprimido declarado, y una primera hoja de hasta 2 millones de celdas y 32 MiB de texto CSV. Para libros mayores, guarda la hoja como CSV UTF-8.
- **Exacta.** Un mapa de claves de texto conserva los valores únicos normalizados del CSV 1. Al recorrer CSV 2 marca los encontrados mediante igualdad de cadenas. Una tercera pasada clasifica las filas originales de CSV 1.
- **Parcial.** Aho–Corasick recorre cada celda seleccionada de CSV 2 y encuentra los patrones de CSV 1 dentro de ella. El trie usa matrices tipadas y transiciones dispersas. Los enlaces de salida saltan patrones ya hallados, incluidas coincidencias repetidas por sufijo. El coste depende de los nodos creados, la longitud de los textos recorridos y los patrones distintos hallados.
- **Búsqueda.** Una pasada por archivo. Detiene la comprobación de cada fila al encontrar la primera coincidencia y guarda la muestra junto a un mapa de bits. Ambos modos comparten las opciones de recorte, conversión a minúsculas y retirada de marcas diacríticas en NFD.
- **Memoria.** Se usa un Worker por operación, sin duplicar índices. Si el entorno bloquea el Worker, el motor cede periódicamente el hilo entre bloques. Los resultados retienen un bit de clasificación por fila, en bloques dispersos, y las vistas previas. La comparación libera el índice antes de exportar.
- **Salida.** Cada botón recorre los datos y escribe la cabecera y las filas clasificadas, en orden. La salida es CSV con coma, UTF-8 con BOM y separadores de registro CRLF. Conserva los saltos interiores, todos los campos, las filas duplicadas y los valores de texto procesados.
- **Guardado directo.** En una página principal con acceso a `showSaveFilePicker`, cada bloque se escribe en un flujo con contrapresión. La aplicación confirma el guardado tras cerrar el flujo. Al cancelar se aborta la escritura. Si el selector había creado un destino nuevo, el navegador puede dejar un archivo vacío. [Documentación de File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).
- **Descarga compatible.** En un iframe o cuando el selector directo no está disponible, se acumulan bloques hasta **32 MiB por salida**. Si se supera el límite, la aplicación cancela la generación antes de solicitar la descarga. Para salidas mayores, abre CSV MATCH como página principal en un navegador con guardado directo.

Los límites por seguridad son **192 MiB estimados** para las claves del índice exacto, **2.097.151 nodos de patrón** para el índice parcial, **16 MiB de mapa de bits por archivo**, **1024 columnas** y **8.388.608 unidades UTF-16 de contenido por registro**. El índice parcial necesita hasta 62 MiB en matrices principales, más enlaces auxiliares y memoria transitoria durante el crecimiento. El presupuesto del índice exacto es una estimación, y el navegador puede asignar memoria adicional. Si un índice supera el límite, la operación termina con un mensaje para dividir CSV 1. La cardinalidad y longitud de los patrones determinan la capacidad además del número de filas.

El lector XLSX se carga desde `js/vendor/` solo al abrir un libro. Incluye la distribución mini de SheetJS CE 0.20.3 con una envoltura para ejecutarla en el Worker local y la licencia Apache 2.0. [Distribución oficial de SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/standalone/).

## Integración

Inserta el componente en una página anfitriona UTF-8. El Shadow DOM encapsula los estilos y los controles. El CSS se localiza a partir de la ruta de `app.js`.

```html
<script defer src="/CSV-MATCH/js/engine.js"></script>
<script defer src="/CSV-MATCH/js/app.js"></script>
<div>
  <csv-match lang="es" style="--csv-match-max-width: 1500px"></csv-match>
</div>
```

También puedes incrustar `index.html`. Ajusta la altura del iframe en la web anfitriona. Si aplicas `sandbox`, `allow-scripts` habilita la herramienta y `allow-downloads` permite exportar. La descarga del iframe usa la alternativa limitada a 32 MiB. En webs con CSP, permite los recursos locales de la aplicación y `worker-src blob:` para habilitar el Worker.

```html
<iframe src="/CSV-MATCH/index.html" title="CSV MATCH"
        sandbox="allow-scripts allow-downloads"
        style="width: 100%; height: 950px; border: 0"></iframe>
```

## Verificación

Pruebas en Windows 11 Pro, AMD Ryzen 7 3700X, Node 24.19.0 y Chrome 157.0.8103.38. La batería del motor cubre la estructura CSV, Unicode, normalización, clasificación, búsqueda, exportación, cancelación y límites. La de navegador ejecutó ambos modos por `file://` en un perfil automatizado sin red, verificó los cuatro nombres de descarga, los bytes de casos con comillas y saltos interiores, la recuperación sin Worker, el componente incrustado y el iframe con sandbox. También verificó la escritura progresiva y su cancelación mediante un `FileSystemWritableFileStream` de OPFS. El selector de destino del sistema queda pendiente de una prueba interactiva. El navegador integrado de Codex bloqueó la apertura `file://` por su política de URLs.

La batería de navegador también verifica la comparación mixta con CSV de punto y coma y XLSX, el relleno de ceros y la distinción de números que Excel muestra con la misma notación científica.

### Referencia independiente para CSV

`tests/audit_csv.py` usa el lector CSV de Python y construye su propio conjunto de claves a partir del segundo archivo. Indica los separadores y las posiciones de las columnas empezando por 1. Para una comparación literal, deja desactivadas las opciones `--trim`, `--ignore-case` y `--ignore-accents`. Si proporcionas las dos exportaciones, valida las cabeceras y compara cada fila de cada partición en el orden esperado.

```powershell
python tests/audit_csv.py origen.csv destino.csv --source-column 1 --target-separator ';' --target-columns 2 3 4 --matched COINCIDEN.csv --unmatched NO_COINCIDEN.csv
```

El resumen contiene solo contadores. Para guardar ejemplos con valores originales y escapados, añade `--local-diagnostics` con la ruta a un archivo nuevo fuera de Git. Conserva los datos de entrada, las exportaciones y los diagnósticos privados fuera del repositorio.

### Rendimiento reproducible

Cada volumen corresponde a filas **por archivo**. Los tiempos de comparación incluyen construcción del índice y clasificación. Los de descarga incluyen relectura, generación y descarga compatible. El ensayo comprobó las seis salidas por escenario, las dos particiones de cada tipo de comparación y las dos de búsqueda. Verificó las cabeceras y los valores de cada fila exportada, así como orden y cantidades, con un lector independiente para esos datos sintéticos de una línea por registro. Las pruebas funcionales cubren los campos multilínea y los duplicados.

| Filas | Patrones únicos | Tamaños CSV 1 / CSV 2 (MiB) | Carga y vistas previas (s) | Exacta (s) | Parcial (s) | Búsqueda (s) | Descargas por archivo (s) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10.000 | 10.000 | 0,18 / 0,17 | 0,17 | 0,04 | 0,03 | 0,02 | 0,11–0,20 |
| 100.000 | 100.000 | 1,81 / 1,74 | 0,10 | 0,34 | 0,21 | 0,11 | 0,16–0,20 |
| 500.000 | 200.000 | 9,06 / 8,70 | 0,11 | 1,41 | 1,13 | 0,64 | 0,37–0,52 |
| 1.000.000 | 200.000 | 18,12 / 17,40 | 0,10 | 2,43 | 2,16 | 1,12 | 0,57–0,92 |
| 2.000.000 | 200.000 | 36,24 / 34,81 | 0,10 | 4,77 | 4,87 | 2,24 | 0,96–1,62 |
| 10.000, cadenas de 608 caracteres | 2.000 | 5,90 / 3,04 | 0,11 | 0,08 | 0,23 | 0,06 | 0,13–0,16 |
| 1.000.000, alta cardinalidad | 1.000.000 | 18,12 / 17,40 | 0,11 | 4,02 | 2,11 | 1,04 | 0,50–0,78 |

El ensayo separado del motor en Node muestreó la memoria residente del proceso durante las fases de trabajo. Observó hasta **250 MiB** en el caso de dos millones de filas por archivo y **307 MiB** en el de un millón de patrones únicos. Las cifras incluyen el runtime de Node y memoria de ensayos previos que el proceso retuvo. El ensayo de Chrome midió tiempos, con la memoria del Worker fuera de esa medición.

### Ejecutar las pruebas

Desde la carpeta de la aplicación, con Node.js 24. `playwright-core` se usa solo en las pruebas de navegador y puede instalarse en una carpeta temporal. La variable `CSV_MATCH_PW` acepta la ruta a su directorio si no está en la ruta de módulos de Node.

```powershell
node --test tests/engine.test.js
node --test tests/browser.test.js
node tests/performance.js
node --expose-gc tests/performance.js --engine
```
