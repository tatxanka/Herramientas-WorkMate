# CSV MATCH

Abre `index.html` en un navegador de escritorio. La aplicación procesa archivos locales y funciona sin servidor, red ni instalación. Conserva `index.html`, `js/` y `css/` juntos al copiarla.

- **Comparar archivos.** Carga dos archivos CSV o XLSX, elige una columna del origen y una o más del segundo archivo. Una coincidencia en cualquiera de las columnas seleccionadas basta para clasificar la fila de origen. Los valores vacíos no coinciden y las filas repetidas se clasifican por separado. Elige coincidencia exacta o parcial y descarga `COINCIDEN.csv` y `NO_COINCIDEN.csv`. El indicador `+N` muestra todas las columnas seleccionadas al pasar el puntero por el selector.
- **Buscar texto.** Carga uno o dos archivos, escribe el texto y selecciona el alcance y las columnas. La aplicación muestra hasta diez coincidencias por archivo. Cada descarga incluye todas las coincidencias del archivo correspondiente.
- Los selectores distinguen encabezados iguales mediante su posición. La vista previa está limitada a diez registros y abrevia las celdas largas. El total aparece cuando termina la lectura completa. Las operaciones validan el CSV entero y señalan el registro con errores de estructura.

## Procesamiento y exportación

- **CSV.** Lectura incremental en bloques de 256 KiB con decodificación UTF-8 estricta. El separador se detecta con la cabecera y hasta cinco registros adicionales. Si ambos formatos encajan, se elige la coma. Se admiten BOM, LF y CRLF, comillas escapadas, saltos interiores y campos vacíos.
- **XLSX.** Se usa la primera hoja del libro y se indica su nombre en la ficha del archivo. La primera fila del rango de datos es la cabecera. Las celdas de texto se conservan literalmente. Para números con formato General o mostrados en notación científica, se usa el valor numérico almacenado. Los formatos como `000000` conservan su relleno. Las fórmulas usan el resultado guardado. Si Excel perdió dígitos al almacenar un identificador como número, el lector solo puede recuperar el valor almacenado. Se admiten hasta 16 MiB comprimidos, 64 MiB descomprimidos, 500.000 etiquetas de celda en el XML y 2 millones de celdas de rango en la primera hoja. El CSV intermedio admite hasta 32 MiB. Antes de cargar SheetJS se comprueban la estructura ZIP, los tamaños reales por descompresión por bloques y los CRC. Los XLSX comprimidos requieren `DecompressionStream('deflate-raw')`. Para libros que excedan esos límites, guarda la hoja como CSV UTF-8.
- **Exacta.** Un mapa de claves de texto conserva los valores únicos normalizados del CSV 1. Al recorrer CSV 2 marca los encontrados mediante igualdad de cadenas. Una tercera pasada clasifica las filas originales de CSV 1.
- **Parcial.** Aho–Corasick recorre cada celda seleccionada de CSV 2 y encuentra los patrones de CSV 1 dentro de ella. El trie usa matrices tipadas y transiciones dispersas. Los enlaces de salida saltan patrones ya hallados, incluidas coincidencias repetidas por sufijo. El coste depende de los nodos creados, la longitud de los textos recorridos y los patrones distintos hallados.
- **Búsqueda.** Una pasada por archivo. Detiene la comprobación de cada fila al encontrar la primera coincidencia y guarda la muestra junto a un mapa de bits. Ambos modos comparten las opciones de recorte, conversión a minúsculas y retirada de marcas diacríticas en NFD.
- **Memoria.** Se usa un Worker por operación. Los resultados retienen un bit de clasificación por fila, en bloques dispersos, y las vistas previas. La comparación libera el índice antes de exportar. Si una CSP o el navegador bloquea el Worker, el modo alternativo limita cada operación a 512 KiB de CSV en total y cada registro a 64 Ki unidades UTF-16. Para importar XLSX en ese modo, los límites son 256 KiB comprimidos, 1 MiB descomprimido, 20.000 etiquetas de celda y 25.000 celdas de rango. El motor cede el hilo entre bloques y avisa si el tamaño exige habilitar el Worker.
- **Salida.** Cada botón recorre los datos y escribe la cabecera y las filas clasificadas, en orden. La salida es CSV con coma, UTF-8 con BOM y separadores de registro CRLF. Conserva los saltos interiores, todos los campos, las filas duplicadas y los valores de texto procesados.
- **Guardado directo.** Se utiliza en Chrome cuando el contexto permite el selector y todos los originales se abrieron mediante `showOpenFilePicker`. Antes de escribir, `isSameEntry()` verifica que el destino es distinto de todos los originales cargados. Dos archivos homónimos en carpetas diferentes son entradas distintas. El flujo escribe por bloques, se confirma con `close()` y se aborta al cancelar. El selector del navegador puede dejar un archivo nuevo vacío si se cancela. Antes de procesar y exportar se comprueba si los originales cambiaron o dejaron de ser legibles. Para archivos seleccionados sin identidad, la aplicación usa la descarga del navegador. [Documentación de File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).
- **Descarga compatible.** Sin guardado directo se calcula el tamaño antes de generar el archivo. Hasta **32 MiB** se usa una descarga en memoria. Por encima de ese umbral, los contextos del mismo origen que dispongan de OPFS pueden escribir por bloques a un archivo temporal de hasta **512 MiB**, sujeto a cuota y espacio. El navegador descarga desde ese archivo. Se borra al cancelar o fallar, o diez minutos después de solicitar la descarga. Si se cierra la página antes, las exportaciones grandes posteriores limpian las copias caducadas. No se envían datos a ningún servidor. Cuando no hay una ruta viable, se muestra el límite antes de generar la salida.
- **CSV y fórmulas.** La salida fiel conserva valores que comienzan por `=`, `+`, `-`, `@` o caracteres de control. Excel y otras hojas de cálculo pueden interpretarlos como fórmulas si se abre directamente el CSV. Para datos no confiables, usa **Datos → Desde texto/CSV** y asigna el tipo **Texto** antes de cargar o usa un visor de texto. La aplicación muestra CSV y XLSX como texto y no ejecuta su contenido como HTML. [Riesgo de inyección de fórmulas en CSV](https://owasp.org/www-community/attacks/CSV_Injection).

Los límites por seguridad son **192 MiB estimados** para las claves del índice exacto, **2.097.151 nodos de patrón** para el índice parcial, **16 MiB de mapa de bits por archivo**, **1024 columnas** y **8.388.608 unidades UTF-16 de contenido por registro**. El índice parcial necesita hasta 62 MiB en matrices principales, más enlaces auxiliares y memoria transitoria durante el crecimiento. El presupuesto del índice exacto es una estimación, y el navegador puede asignar memoria adicional. Si un índice supera el límite, la operación termina con un mensaje para dividir CSV 1. La cardinalidad y longitud de los patrones determinan la capacidad además del número de filas.

El lector XLSX se carga desde `js/vendor/` solo al abrir un libro. Incluye la distribución mini de SheetJS CE 0.20.3 con una envoltura para ejecutarla en el Worker local y la licencia Apache 2.0. El cuerpo original se verificó byte a byte con la distribución oficial, SHA-256 `0cb353f830d7288385492c83d277b058ddeac664ca51cf1393aa1fd3e2b70939`. [Distribución oficial de SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/standalone/).

## Integración

Para un portal HTML local con `index.html` junto al directorio `CSV-MATCH/`, usa un iframe con ruta relativa y sin sandbox. Ambas páginas se abren por `file://`, sin servidor ni conexión.

```html
<iframe src="./CSV-MATCH/index.html" title="CSV MATCH"
        style="width: 100%; height: 950px; border: 0"></iframe>
```

Chrome trató el iframe local y el portal como orígenes distintos. La carga, la comparación, la búsqueda y las descargas pequeñas funcionan dentro del marco. Para una salida mayor de 32 MiB, usa **Abrir CSV MATCH en otra pestaña**, vuelve a seleccionar los originales mediante el selector de Chrome y guarda desde esa pestaña si la API está disponible.

Para usar el componente en una página anfitriona UTF-8, conserva los recursos y las rutas relativas. El Shadow DOM encapsula los estilos y los controles. El CSS se localiza a partir de la ruta de `app.js`.

```html
<script defer src="./CSV-MATCH/js/engine.js"></script>
<script defer src="./CSV-MATCH/js/app.js"></script>
<div>
  <csv-match lang="es" style="--csv-match-max-width: 1500px"></csv-match>
</div>
```

En un marco sandbox, `allow-scripts` habilita la herramienta y `allow-downloads` habilita las descargas. Si el origen es opaco o distinto, la aplicación depende de esos permisos y no puede inspeccionar las reglas del marco anfitrión.

| Contexto | Exportación comprobada en Chrome |
| --- | --- |
| `file://` | Hasta 32 MiB cuando no hay guardado directo. El Chrome de prueba bloqueó OPFS bajo `file://`. |
| Portal local `file://`, iframe relativo sin sandbox | Hasta 32 MiB. En Chrome no compartió origen con el portal. La aplicación ofrece abrirse en una pestaña propia para intentar el guardado directo. |
| Página HTTP en loopback o componente en ella | Guardado directo cuando el navegador permite el selector y los originales tienen identidad. OPFS disponible para descargas grandes. |
| Iframe del mismo origen en loopback | Descarga por OPFS comprobada con 35.000.011 bytes. El selector real pasó la comprobación de origen. |
| Iframe de terceros o sandbox con origen opaco | CSV en memoria hasta 32 MiB con `allow-downloads`. El selector real devolvió `SecurityError`. |
| CSP con `worker-src 'none'` | Modo alternativo acotado. Los archivos grandes requieren habilitar `worker-src blob:`. |

La CSP del anfitrión debe permitir sus propios scripts y estilos, incluidos los recursos locales de CSV MATCH. Puede mantener `connect-src 'none'`. Para OPFS o el selector de archivos, usa HTTPS o un origen local de confianza como `http://127.0.0.1`. Los ensayos automatizados usan Chrome 157 en Windows 11. El guardado se verificó con handles reales y escritura atómica de OPFS, sustituyendo la elección interactiva del destino. El diálogo nativo del sistema no se operó en estas pruebas.

```html
<iframe src="/CSV-MATCH/index.html" title="CSV MATCH"
        sandbox="allow-scripts allow-downloads"
        style="width: 100%; height: 950px; border: 0"></iframe>
```

## Verificación

Pruebas en Windows 11 Pro, AMD Ryzen 7 3700X, Node 24.19.0 y Chrome 157.0.8103.38. La batería verifica CSV y XLSX, Unicode, clasificación, exportación, cancelación, mutación e identidad de los archivos, CSP, límites y aislamiento de estilos. La descarga grande se coteja byte a byte mediante SHA-256 con una salida construida de forma independiente, con V8 configurado a 128 MiB de heap antiguo. Las pruebas de XLSX incluyen un ZIP de menos de 100 KiB que se expande a 65 MiB, tamaños declarados falsos, CRC incorrecto, alta densidad y la importación de 400.000 celdas.

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
| 10.000 | 10.000 | 0,18 / 0,17 | 0,15 | 0,04 | 0,03 | 0,02 | 0,13–0,21 |
| 100.000 | 100.000 | 1,81 / 1,74 | 0,12 | 0,33 | 0,21 | 0,11 | 0,21–0,27 |
| 500.000 | 200.000 | 9,06 / 8,70 | 0,10 | 1,36 | 0,97 | 0,51 | 0,56–0,84 |
| 1.000.000 | 200.000 | 18,12 / 17,40 | 0,11 | 2,48 | 1,87 | 1,03 | 0,94–1,45 |
| 2.000.000 | 200.000 | 36,24 / 34,81 | 0,09 | 4,33 | 3,74 | 2,10 | 1,81–2,67 |
| 10.000, cadenas de 608 caracteres | 2.000 | 5,90 / 3,04 | 0,09 | 0,08 | 0,23 | 0,05 | 0,16–0,21 |
| 1.000.000, alta cardinalidad | 1.000.000 | 18,12 / 17,40 | 0,10 | 3,87 | 2,05 | 1,04 | 1,05–1,47 |

El ensayo separado del motor en Node, con `--max-old-space-size=384`, observó hasta **220 MiB de RSS muestreada** con dos millones de filas por archivo y **263 MiB** con un millón de patrones únicos. El ensayo XLSX de 400.000 celdas, con `--max-old-space-size=256`, tardó **1,83 s** en la importación y observó **316 MiB de RSS muestreada**. Las cifras incluyen el runtime de Node y las asignaciones de preparación o de ensayos anteriores. El ensayo de Chrome midió tiempos. El límite de heap antiguo de V8 usado para la descarga grande no equivale a medir la memoria total del navegador.

### Ejecutar las pruebas

Desde la carpeta de la aplicación, con Node.js 24. `playwright-core` se usa solo en las pruebas de navegador y puede instalarse en una carpeta temporal. La variable `CSV_MATCH_PW` acepta la ruta a su directorio si no está en la ruta de módulos de Node.

```powershell
node --test tests/engine.test.js
node --max-old-space-size=256 --test tests/xlsx-security.test.js
node --test tests/browser.test.js
node tests/performance.js
node --expose-gc tests/performance.js --engine
```
