# DIVIDER RECORDS v1.0.0

Divide CSV y XLSX por registros. Abre **index.html** directamente en Chrome mediante **file://**. La aplicación procesa los datos localmente y funciona sin servidor, instalación ni conexión. Conserva juntos el HTML, CSS, JavaScript y la biblioteca local incluida.

## Uso

1. Selecciona un CSV UTF-8, con o sin BOM, o un XLSX. En CSV se validan ambas interpretaciones de delimitador en una pasada. Si la detección es ambigua, elige **Punto y coma** o **Coma**. En XLSX se selecciona la primera hoja con datos y puedes cambiarla.
2. Revisa el número de registros, las columnas y la vista previa. Por defecto la primera fila es la cabecera y se repite en todas las partes. Desactiva esa opción para incluir la primera fila como registro. La vista previa muestra hasta diez registros y 32 columnas. Los recortes de vista previa no afectan a la salida.
3. En **Registros por archivo**, indica el máximo por parte. Por ejemplo, 100.003 registros con un límite de 20.000 producen cinco partes de 20.000 y una de 3. En **Número de archivos**, las partes se equilibran. Los mismos 100.003 registros en cinco archivos producen tres partes de 20.001 y dos de 20.000.
4. Elige el delimitador de salida y, si lo deseas, edita el nombre base. Los CSV usan UTF-8 con BOM y CRLF entre registros. El formato inicial usa punto y coma para Excel (España). Los nombres siguen el patrón **nombre_001.csv**, con más dígitos cuando hacen falta.
5. Pulsa **Dividir archivo**. Una vez validado el conjunto, descarga cada parte o el ZIP con todas ellas. Si Chrome concede acceso de escritura, **Guardar en carpeta…** escribe progresivamente en una subcarpeta nueva.

Cuando se piden más archivos que registros, se reduce el reparto para evitar partes vacías. Una entrada sin registros no genera archivos. Las líneas CSV completamente vacías se conservan como un registro con todas sus columnas vacías. Un terminador final, por sí solo, no añade un registro. Las filas CSV que contienen campos y tienen una anchura distinta se rechazan, con el número de registro. Se conservan campos vacíos, delimitadores entrecomillados, duplicados, cabeceras repetidas y saltos de línea interiores.

## XLSX e integridad

La aplicación usa el rango desde A1 hasta el extremo del rango guardado o de las celdas con datos y fórmulas, el que llegue más lejos. Conserva las posiciones vacías dentro de ese rango. Exporta las cadenas literalmente y usa la presentación de los números cuando el libro incluye un formato explícito, como los ceros iniciales, las fechas, horas, porcentajes y moneda. Para números con formato General conserva la representación del número almacenado. Excel puede haber redondeado un identificador numérico antes de guardar el XLSX. La hoja de cálculo original es la referencia para formatos de presentación, anchos y redondeos.

Las fórmulas se exportan usando su resultado almacenado. Las que carecen de él se señalan y se convierten en campos vacíos. La aplicación no ejecuta ni recalcula fórmulas. El CSV conserva texto y resultados, y la salida carece de estilos, fórmulas y estructura de libro. [Formato y valores de celda en SheetJS](https://docs.sheetjs.com/docs/csf/cell/)

CSV se lee por bloques de 256 KiB con un parser que conserva su estado entre bloques. La primera pasada valida, cuenta y obtiene una huella encadenada SHA-256. La segunda genera la salida y comprueba que la huella siga siendo igual. Para XLSX se verifica la estructura ZIP, la expansión real y el CRC antes de leer el libro localmente. Se comprueba la huella SHA-256 del libro antes de emitir las partes.

El motor conserva el orden y compara filas leídas, registros asignados, registros escritos, tamaños y recuentos por parte antes de mostrar el informe de éxito. Cada bloque generado se entrega con confirmación. Los ZIP sin compresión reutilizan los blobs de las partes y añaden sus CRC. El modo carpeta cierra cada archivo y comprueba el tamaño y CRC al releerlo. Al cancelar, las descargas incompletas se descartan. Si ya se escribieron archivos en carpeta, el informe identifica la subcarpeta que puede contener resultados incompletos.

Las celdas se muestran como texto. La salida conserva valores que una hoja de cálculo podría interpretar como fórmulas, incluidos los que empiezan por **=**, **+**, **-** o **@**. Para datos no confiables, importa esas columnas como texto.

## Límites en Chrome

| Capacidad | Límite |
| --- | --- |
| CSV con Worker | Entrada de 1 GiB, 1.024 columnas y 2 Mi de unidades UTF-16 por registro. |
| XLSX con Worker | Entrada de 16 MiB, 64 MiB descomprimidos, 500.000 celdas en el libro y un rango de hasta 2 millones de celdas por hoja, con un máximo de 1.024 columnas. |
| Descargas individuales y ZIP | Hasta 96 MiB acumulados de CSV y hasta 2.000 partes. El ZIP añade sus cabeceras. |
| Guardado en carpeta | Hasta 2 GiB acumulados y 2.000 partes. Requiere selección y permiso de escritura. Las partes se guardan directamente en la subcarpeta. |
| Alternativa si falla el Worker | CSV de 2 MiB, XLSX de 1 MiB con 4 MiB de expansión, 25.000 celdas en el libro y 100.000 celdas de rango por hoja. Hasta 16 MiB para descargas. |

El guardado en carpeta está disponible para intentar desde una pestaña de nivel superior que exponga el selector. En el iframe se ofrecen las descargas y **Abrir en otra pestaña**. El selector real de Chrome sin interfaz devolvió cancelación. La escritura con el diálogo nativo de Windows queda pendiente de aceptación interactiva. [File System Access en Chrome](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)

SheetJS CE 0.20.3 se distribuye en **vendor/** con licencia Apache 2.0. La copia local es la misma compilación usada por CSV MATCH v1.0.1, con su envoltura para cargarla en un Worker **file://**. El lector solo se inicializa al procesar XLSX.

## Registrar en Herramientas WorkMate

En otra instalación, coloca la carpeta de la herramienta en **GESTIONAR ARCHIVOS/DIVIDER-RECORDS** dentro del portal. Desde una cuenta autorizada, activa **Modo edición**, crea la herramienta con estos valores y pulsa **Aplicar**. Usa **Guardar** para incorporarla al catálogo de esa instalación.

| Campo | Valor |
| --- | --- |
| Nombre | DIVIDER RECORDS |
| Descripción | Divide archivos CSV y XLSX en partes más pequeñas sin perder ni duplicar registros. |
| Categoría | Gestionar archivos |
| Tipo | Aplicación HTML local |
| Ruta | ./GESTIONAR ARCHIVOS/DIVIDER-RECORDS/index.html |

## Pruebas

Desde esta carpeta, usa Node.js 24 y Chrome instalado. Para las pruebas de navegador, instala Playwright Core como dependencia de desarrollo o indica su ubicación mediante **DIVIDER_PLAYWRIGHT**. La batería de navegador usa **file://**, red desactivada y perfiles temporales. Los casos de integración requieren que el portal y CSV MATCH estén instalados en sus rutas hermanas.

    node --test tests/engine.test.js
    node --max-old-space-size=128 --test tests/volume.test.js
    node --test tests/browser.test.js

Desde el ZIP independiente, ejecuta la batería de Chrome excluyendo los dos casos que requieren el portal y CSV MATCH.

    node --test --test-skip-pattern "registro temporal en WorkMate|CSV MATCH abre resultados" tests/browser.test.js

Las pruebas reconstruyen todas las partes con un parser independiente, verifican cabeceras, valores, duplicados, orden y CRC, y vuelven a abrir resultados en CSV MATCH. Los ensayos de volumen generan exclusivamente datos sintéticos, publican tiempos, tamaños y RSS muestreado del proceso Node y limpian los archivos temporales que crean. El ensayo de navegador también reconstruye 1.000.000 de registros desde el ZIP descargado. Define **DIVIDER_SHOTS=1** para conservar capturas de prueba en **tests/.work/**.
