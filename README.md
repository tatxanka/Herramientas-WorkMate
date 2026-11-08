# Herramientas WorkMate

Portal local para organizar y abrir herramientas independientes. La interfaz reutiliza los criterios visuales de CSV MATCH v1.0.1. El catálogo y las cuentas se guardan en un JSON local.

El [ZIP adjunto a Portal v1.0.0](https://github.com/tatxanka/Herramientas-WorkMate/releases/tag/portal-v1.0.0) contiene el portal y una carpeta vacía **BUSCAR Y COMPARAR**. Los archivos fuente que genera GitHub contienen el repositorio completo. [CSV MATCH v1.0.1](https://github.com/tatxanka/Herramientas-WorkMate/releases/tag/v1.0.1) conserva su propia descarga y su tag histórico.

## Abrir y configurar

1. Abre **index.html** directamente en Chrome desde **C:\laragon\www\Herramientas Workmate**. Se requiere un navegador de escritorio con Web Crypto habilitado en el contexto local. El portal funciona sin instalación, servidor ni conexión.
2. En **Primera configuración**, crea la cuenta propietaria con un identificador único y una contraseña de al menos 12 caracteres. El asistente propone las categorías Buscar y comparar y Gestionar archivos. Si usas el ZIP independiente, desmarca **Registrar CSV MATCH**. Para añadir la herramienta después, coloca su carpeta en **BUSCAR Y COMPARAR/CSV-MATCH** y registra su ruta relativa en el catálogo.
3. Elige **Guardar archivo directo** o **Usar JSON manual**. En modo manual, pulsa **Descargar JSON** y después **Seleccionar copia descargada**. El portal compara la copia leída con el contenido exportado antes de activar la cuenta.
4. En las siguientes sesiones selecciona **Admin**, **Gestor** o **Usuario**, elige tu cuenta y escribe su contraseña. Desde el menú puedes bloquear la sesión, cerrarla y cambiar de cuenta.

## Catálogo

El menú dispone de búsqueda por nombre, descripción, categorías y palabras clave. Los favoritos, las últimas 15 aperturas, la vista lista o cubos, el ancho, el estado del menú y los acordeones son personales. El botón **Catálogo** del menú contraído abre temporalmente el árbol completo.

Arrastra el separador entre el menú y el visor para cambiar el ancho. Con el foco en el separador, usa las flechas izquierda y derecha para ajustar de 8 en 8 píxeles, **Mayús** y flecha para pasos de 32, o **Inicio** y **Fin** para ir a los límites. **Esc** cancela un arrastre. En ventanas de hasta 500 píxeles, el menú expandido se superpone al visor y el separador se oculta. En escritorio, el ancho visible se ajusta al espacio disponible y el portal recupera el ancho preferido al ampliar la ventana.

- Activa **Modo edición** para trabajar con un borrador. Usa **Herramienta**, **Categoría** y las opciones de cada elemento según tus permisos. Desde una categoría puedes crear subcategorías. Al eliminar una categoría con contenido, confirma un destino autorizado para sus hijos directos.
- Arrastra a la parte superior de una fila de categoría para reordenar categorías. Suelta sobre el cuerpo de la fila para anidar una categoría o introducir una herramienta. En herramientas, suelta sobre otra fila para colocarla antes. La zona **Soltar en el nivel principal** mueve al nivel raíz. **Mover arriba**, **Mover abajo** y **Cambiar categoría** ofrecen las mismas operaciones por teclado.
- **Ocultar para mí** conserva el orden y la categoría. Para recuperarla, abre **Herramientas ocultas**. La ocultación de ámbito afecta a quienes comparten el recurso. **Deshabilitar** bloquea su apertura. Los administradores con permisos pueden reconocer el estado y revertirlo.
- Los iconos integrados se cargan localmente. Puedes importar PNG, JPEG, GIF, WebP o un SVG de formas sencillas hasta 256 KiB. El portal valida los formatos admitidos y convierte la imagen elegida en un PNG de 96 × 96. Los SVG con código, estilos o referencias externas se rechazan.
- **Deshacer** y **Rehacer** recorren operaciones del borrador. **Aplicar** cambia la vista activa para previsualizar los cambios. **Guardar** valida y persiste el borrador. **Descartar** vuelve al último JSON verificado. La bitácora registra las últimas 300 operaciones administrativas del estado guardado.

## Cuentas y permisos

**Admin → Gestor → Usuario**. El propietario inicial administra el catálogo y todos los ámbitos. Puede crear otros administradores con su propia rama de cuentas. Las cuentas administrativas adicionales parten con derechos limitados. El propietario debe conceder expresamente los derechos que necesiten.

Un gestor administra los usuarios que dependen de él. En **Cuentas y permisos**, el árbol muestra relaciones y estado. Selecciona una cuenta para editar su ficha, cambiar su estado, restablecer su contraseña o consultar sus permisos y acceso a recursos. Para deshabilitar un superior, deshabilita primero sus cuentas activas dependientes. Solo quien tiene autorización administrativa puede reasignar superiores o roles dentro de su ámbito.

Cada regla admite **Heredado**, **Permitido** o **Denegado**. Cada tramo de la jerarquía limita los permisos y su transmisión. Delegar un derecho exige disponer de ese derecho como delegable y tener autorización para delegar. La interfaz indica el permiso efectivo y el motivo de un bloqueo. Una cuenta subordinada no puede levantar una restricción de un superior. Una restricción de categoría cubre su árbol. Una restricción directa de herramienta actúa sobre ese recurso.

La protección también se aplica al mover o eliminar contenido. Una cuenta no puede retirar una restricción superior moviendo un recurso fuera de la categoría restringida. Cambiar el padre, el alcance o la visibilidad de una categoría requiere autoridad sobre el contenido afectado.

Los recursos **globales** se administran con permiso sobre el catálogo. Los **personales** se destinan al propietario. Los de **equipo** se comparten con sus subordinados. Las acciones sobre recursos ajenos requieren permiso y ámbito administrativo sobre el recurso.

## Destinos y CSV MATCH

- **Aplicación HTML local.** Usa una ruta relativa dentro de la raíz, por ejemplo **./BUSCAR Y COMPARAR/CSV-MATCH/index.html**. Se abre en el visor y **Otra pestaña** la abre de forma independiente. La ubicación física y la categoría lógica son independientes.
- **Página web.** Se admite HTTP o HTTPS sin credenciales en la URL. La página se abre aparte cuando pulsas **Intentar apertura**. Puedes registrar WorkMate como cualquier otro destino.
- **Documento, imagen, carpeta, ejecutable, acceso directo u otro archivo.** Puedes utilizar una ruta relativa, una ruta Windows absoluta, UNC o una URL de archivo. La ficha muestra el destino, permite copiarlo y ofrece **Intentar apertura**. Chrome puede navegar, descargar o pedir autorización según el recurso y su configuración.
- **Protocolo registrado.** La lista local admite mailto, tel, ms-excel, ms-word, ms-powerpoint y ms-settings. La apertura depende de la asociación instalada y del consentimiento de Windows y Chrome.

El portal muestra **No verificable** cuando carece de acceso autorizado para inspeccionar un destino. Chrome puede mostrar su propia página de error dentro del visor si un HTML local falta. La ficha permite comprobar o corregir su ruta. Las carpetas y ejecutables pueden requerir pegar la ruta en el Explorador de Windows.

CSV MATCH conserva sus archivos, Shadow DOM, selectores, Worker y descargas. La exportación pequeña funciona dentro del iframe local. Para exportaciones grandes, usa **Otra pestaña** y consulta los límites de exportación documentados por CSV MATCH.

## Persistencia, copias y recuperación

- **Archivo directo.** El selector de Chrome vincula el archivo elegido. El guardado comprueba cambios en disco, solicita escritura si hace falta, espera al cierre y relee el archivo. Al cambiar de destino pide confirmación para reemplazar un JSON existente. Cuando Chrome conserva el vínculo, el portal recupera el archivo o muestra **Reconectar** si debe renovar su permiso.
- **JSON manual.** Cada guardado descarga una nueva copia. Selecciónala desde el diálogo para verificarla. Guarda la última copia verificada en una ubicación controlada y utiliza **Abrir JSON** si el navegador pierde la caché. El archivo original permanece disponible como copia previa.
- **Caché del navegador.** IndexedDB recuerda la copia verificada o el vínculo. Las preferencias de navegación usan una caché por cuenta y revisión, y se incluyen en el archivo al guardar. El JSON es la referencia portátil. El pie del portal muestra el nombre del archivo y la fecha del último guardado.
- **Copias.** El propietario exporta la última configuración guardada desde **Preferencias y archivo**. En modo edición, **Importar catálogo** sustituye categorías y herramientas y conserva las cuentas. **Restaurar copia** recupera una versión completa del mismo catálogo, tras validación y confirmación. La operación queda pendiente hasta guardar y el portal ofrece una descarga de la versión anterior.
- **Pérdida de la contraseña propietaria.** En la pantalla de perfiles, **Recuperación del propietario** permite seleccionar una copia JSON válida, definir una nueva contraseña y verificar un nuevo archivo. Conserva el original. La posesión del archivo y el acceso local permiten esta recuperación.
- **Traslado.** Copia la raíz con sus recursos y el último JSON verificado. Abre **index.html**, selecciona **Abrir JSON** y elige esa copia. Revisa las rutas absolutas. Cada equipo trabaja con su propio archivo y las copias no se sincronizan automáticamente.

El esquema identifica catálogo, propietario, versión y revisión. La importación valida campos, límites, IDs, rutas, verificadores, relaciones, permisos y ciclos. El lector admite el formato de desarrollo v0 sin preferencias y lo migra a v1. Los JSON admiten hasta 8 MiB.

## Seguridad local

Las contraseñas se verifican con PBKDF2-HMAC-SHA-256, sal aleatoria por cuenta y un verificador de 256 bits. El mínimo es de 600 000 iteraciones y el máximo configurable de 2 000 000. El valor configurado se aplica a las nuevas contraseñas y a los restablecimientos. El navegador debe permitir Web Crypto en el contexto local.

Los permisos son controles organizativos. Quien pueda leer o modificar el JSON, el código o los archivos de herramientas puede eludirlos. Protege esos archivos con los permisos de Windows. Una aplicación HTML registrada se ejecuta de forma independiente dentro del iframe, por lo que debe proceder de una fuente de confianza. El bloqueo por inactividad mide los eventos que recibe el portal. Chrome puede aislar el iframe local, por lo que su actividad interna no reinicia ese contador. La bitácora local es editable con acceso al archivo.

## Estructura

    index.html
    assets/workmate.svg
    css/{tokens,portal}.css
    js/{model,storage,ui,editor,app}.js
    tests/{model,storage,browser}.test.js
    README.md
    LICENSE
    .gitignore
    BUSCAR Y COMPARAR/
      CSV-MATCH/

La carpeta [CSV-MATCH](BUSCAR%20Y%20COMPARAR/CSV-MATCH/README.md) contiene la aplicación y sus pruebas. El código propio se distribuye bajo la [licencia MIT](LICENSE). El lector XLSX incorpora SheetJS Community Edition bajo [Apache 2.0](BUSCAR%20Y%20COMPARAR/CSV-MATCH/js/vendor/SheetJS-LICENSE.txt).

## Pruebas

Desde la raíz, usa Node.js 24 para las pruebas. Para el navegador, instala Playwright Core como dependencia de desarrollo de prueba o proporciona su ruta con **WORKMATE_PLAYWRIGHT**. Usa Chrome instalado en Windows. Los datos de prueba son sintéticos.

    node --test tests/model.test.js tests/storage.test.js
    node --test tests/browser.test.js

Las pruebas de navegador abren el portal por **file://** con la red desactivada. Cubren autenticación, guardado y reapertura de JSON reales, edición, arrastre, restauración, permisos, recuperación, navegación y destinos locales. Desde el ZIP independiente se ejecutan las pruebas del portal con un visor HTML sintético y se omite el caso de comparación y exportación de CSV MATCH. Al instalar CSV MATCH en la ruta indicada, ese caso se ejecuta automáticamente. Los ensayos del adaptador de escritura directa inyectan errores de disco para probar su tratamiento. Chrome sin interfaz devuelve **AbortError** al invocar el selector nativo y bloquea OPFS en **file://**. La selección y el guardado directo mediante el diálogo de Windows requieren aceptación manual en Chrome con interfaz.

Define **WORKMATE_SHOTS=1** antes de ejecutar las pruebas de navegador para guardar en **tests/.work/** las capturas de escritorio, tablet y móvil. Los casos del separador también verifican dimensiones y posiciones calculadas, límites de ancho, captura del puntero y persistencia entre perfiles.
