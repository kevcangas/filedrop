# Enlace — archivos, portapapeles y notificaciones entre celulares y PCs

Prototipo funcional de transferencia de archivos, sincronización de
portapapeles y notificaciones nativas entre **varios celulares y varias
computadoras**, en la misma red WiFi o desde afuera si expones el servidor a
internet, sin hosting fijo, sin cuentas y sin nube.

Una sola computadora corre el servidor (la "anfitriona"). Cualquier otro
dispositivo —celular o computadora— se conecta a ella por IP (o por la
dirección pública, si expusiste el servidor), y desde ese momento todos se
ven entre sí: cualquiera puede elegir a cuál de los demás mandarle un
archivo o el portapapeles.

Todo el sitio está protegido con una **contraseña de acceso**: nadie puede
ver ni usar nada de Enlace sin escribirla primero, así que es más seguro
exponerlo fuera de la red local si hace falta (ver más abajo).

## Cómo correrlo

### 0. Antes de arrancar: configura tu contraseña y variables (.env)

Copia el archivo `.env.example` a `.env`:

```bash
cp .env.example .env
```

Abre `.env` con un editor de texto y define tu propia contraseña en la variable:

```env
ENLACE_PASSWORD=tu-contrasena-segura
```

*(Si dejas `ENLACE_PASSWORD` vacía, Enlace generará automáticamente una contraseña aleatoria segura al arrancar y la imprimirá en la consola).*

### 1. En la computadora anfitriona

**La forma fácil (doble clic, sin escribir comandos):**

Doble clic en `iniciar.sh` (si tu administrador de archivos pregunta
"¿Ejecutar o mostrar?", elige **Ejecutar**), o desde una terminal:
`./iniciar.sh`.

Esto revisa que tengas Python instalado, instala lo que haga falta,
arranca Enlace y **abre solo tu navegador** ya en la dirección correcta.
Deja esa ventana/terminal abierta mientras uses Enlace; para cerrarlo,
ciérrala (o `Ctrl+C`).

Requisito único: tener **Python 3.10 o más nuevo** instalado en esa
computadora (una sola vez; los dispositivos que solo se conectan — celular
u otra PC — no necesitan Python para nada, solo un navegador).

*¿Quieres que Enlace corra siempre, con IP fija, sin dejar una terminal
abierta? Mira las secciones "Contenedor Docker" y "Aplicación nativa en
Linux" más abajo.*

**La forma manual (terminal), si prefieres verlo paso a paso:**

Necesitas Python 3.10 o más nuevo.

```bash
cd filedrop
pip install -r requirements.txt
python3 server.py
```

Vas a ver algo así en la terminal:

```
Enlace corriendo
   Esta computadora (anfitriona): http://localhost:41823/
   Celular (misma WiFi):          http://192.168.1.50:41823/mobile
   Otra computadora (misma WiFi): http://192.168.1.50:41823/desktop
   Clave de acceso:               tu-contraseña
   Puerto del servidor:           41823
------------------------------------------------------------
   Consejo: esto por si solo SOLO funciona dentro de tu misma red WiFi.
   Si alguien se va a conectar desde otra red, usa un tunel como ngrok.
```

Por defecto, Enlace escucha en el puerto fijo **41823** (puedes cambiarlo si deseas en tu archivo `.env` configurando `ENLACE_PORT`).

Con cualquiera de las dos formas, abre (o se abre solo) la dirección de
"Esta computadora (anfitriona)" en el navegador de esa misma PC. Te va a
pedir la contraseña de acceso primero; después de escribirla, verás tu IP
local, la lista de dispositivos conectados, el envío de archivos, el buzón
y el portapapeles compartido.

### 2. En un celular

1. Conéctate a la **misma red WiFi** que la anfitriona (o mira la sección de
   acceso desde afuera si no es posible).
2. Abre el navegador y entra a `http://<IP_DE_LA_ANFITRIONA>:<PUERTO>/mobile`
   (usa la dirección exacta que muestra la terminal, el puerto cambia cada vez).
3. Escribe la contraseña de acceso cuando te la pida.
4. Toca el menú del navegador → **"Agregar a pantalla de inicio"** (o
   "Instalar app"). Esto la deja como un ícono normal en tu celular.
5. Dentro de la app, escribe la IP:puerto de la anfitriona, ponle un alias y
   toca **Conectar**. Esa dirección queda guardada para la próxima vez.

### 3. En otra computadora

Igual que el celular, pero abriendo `http://<IP_DE_LA_ANFITRIONA>:<PUERTO>/desktop`
en su navegador (también pide la contraseña primero). Se puede instalar como
app de escritorio (Chrome/Edge ofrecen "Instalar" en la barra de
direcciones) para que quede como una ventana aparte, con notificaciones
incluidas.

No hace falta correr `server.py` en esa segunda computadora: solo la
anfitriona necesita el servidor corriendo; las demás son "clientes" como
cualquier celular.

## Dos modos: solo local, o con acceso desde afuera

El servidor (`server.py`) **siempre corre igual**, y por sí solo **siempre
es solo local** — nunca sale a internet por su cuenta. Salir a internet es
un paso aparte y separado (prender un túnel) que tú decides hacer o no cada
vez que usas Enlace. Así que en realidad son dos "modos" que eliges:

- **Modo local** (por defecto): solo corres `server.py`. Únicamente
  dispositivos en tu misma red WiFi pueden conectarse. Nada sale a internet.
- **Modo con acceso externo**: corres `server.py` **y además** un túnel
  (ngrok u otro) en otra terminal. Mientras ese túnel esté abierto, cualquiera
  con la dirección y la contraseña puede entrar desde otra red. En cuanto
  cierras el túnel, vuelves a estar en modo local — el servidor nunca se
  apaga ni cambia, solo dejas de estar expuesto a internet.

### Modo local (dentro de la misma WiFi)

1. Abre una terminal en la carpeta `filedrop` y corre:
   ```bash
   python3 server.py
   ```
2. Usa las direcciones que te muestra la terminal (`http://192.168.x.x:<puerto>/...`,
   con el puerto real que te haya tocado esa vez) desde otros dispositivos
   conectados a la **misma red WiFi**.
3. Ya está — no hagas nada más. Nadie fuera de tu WiFi puede llegar a Enlace
   en este modo, aunque no tengas el túnel instalado siquiera.

### Modo con acceso externo (otra red / datos móviles)

1. Deja `server.py` corriendo (paso 1 de arriba, en su propia terminal — no
   lo cierres).
2. Abre una **segunda terminal**, sin tocar la primera, y ahí corre el túnel,
   apuntando al puerto que te mostró la terminal de `server.py` (no siempre
   es el mismo, cambia cada vez que arrancas). Con ngrok, por ejemplo, si tu
   terminal dijo puerto `41823`:
   ```bash
   ngrok http 41823
   ```
   Si prefieres no tener que revisar el puerto cada vez, define uno fijo con
   `ENLACE_PORT` (ver más abajo) y usa siempre ese mismo número en el túnel.
3. ngrok te va a mostrar una dirección tipo
   `https://algo-al-azar.ngrok-free.app` (cambia cada vez que lo abres, salvo
   que tengas cuenta paga con dominio fijo). Esa es la que compartes con
   quien se quiera conectar desde afuera, agregándole `/mobile` o `/desktop`
   al final — igual que con la IP local. Les va a pedir la contraseña de
   acceso antes de dejarlos entrar.
4. **Para volver a modo local**, simplemente cierra esa segunda terminal
   (`Ctrl+C` sobre la ventana de ngrok, o ciérrala). La dirección pública
   deja de funcionar al instante; `server.py` sigue corriendo normal en tu
   red local, sin que hayas tocado nada de él.

Cada vez que vuelvas a abrir el túnel te va a tocar una dirección nueva (con
la versión gratis de ngrok), así que tendrás que volver a compartirla. Si
quieres una dirección fija, ngrok, Cloudflare Tunnel y Tailscale Funnel
ofrecen esa opción en sus planes o configuraciones avanzadas — revisa su
documentación si te interesa.

Cloudflare Tunnel y Tailscale Funnel funcionan con la misma lógica de "dos
terminales, prendes y apagas cuando quieras" — solo cambia el comando que
usas en el paso 2.

**Opción alterna, más permanente: redirección de puertos en el router.**
Entras a la configuración de tu router (normalmente `192.168.1.1` o
similar) y agregas una regla de "port forwarding" que mande el puerto que
te muestre la terminal (o uno fijo que hayas puesto con `ENLACE_PORT`, para
no tener que cambiar la regla cada vez) de tu IP pública hacia la IP local
de la anfitriona. A diferencia del túnel,
esto queda expuesto a internet todo el tiempo que la regla esté activa (no
es "prender y apagar" tan simple), así que solo hazlo si entiendes ese
riesgo y con la contraseña ya cambiada; para volver a modo local tendrías
que borrar o desactivar la regla en el router.

Si quieres que la dirección pública (la de ngrok, o tu IP pública) aparezca
también en el mensaje que imprime la terminal al arrancar `server.py`,
puedes correr el servidor así:

```bash
ENLACE_PUBLIC_URL="https://algo-al-azar.ngrok-free.app" python3 server.py
```

Esto es solo para que se vea impreso en la terminal como recordatorio; no
hace falta para que Enlace funcione.


## Buzón: guardar algo para descargar después

Normalmente, un envío de archivo en Enlace es "en vivo": tiene que estar
conectado quien lo manda y quien lo recibe al mismo tiempo. El **Buzón** es
una segunda forma de mandar algo que no tiene esa limitación: el archivo se
sube una sola vez al servidor (por HTTP normal, no por WebSocket) y se queda
guardado ahí, listo para que el destino lo descargue cuando se conecte,
aunque haya pasado tiempo y el que lo mandó ya ni siquiera siga conectado.

Cómo usarlo:

1. Antes de soltar o elegir el archivo, marca la casilla **"Guardar en el
   buzón"** junto al botón de "Elegir una carpeta".
2. Suelta o elige el archivo (o varios, o una carpeta — se empaquetan en
   `.zip` igual que en un envío normal). Se sube al servidor de una vez;
   verás la barra de progreso de la subida en "Transferencias".
3. Si tenías seleccionado un dispositivo en la lista, el archivo queda
   dirigido solo a ese dispositivo; si no habías seleccionado ninguno, queda
   disponible para **todos** los que se conecten.
4. Quien lo recibe lo ve en su propio panel de **"Buzón"**, con un botón de
   **Descargar** y otro de **Borrar**. Si estaba conectado en ese momento,
   le llega un aviso al instante; si no, lo ve en cuanto entre y toque
   "Actualizar" (o se conecte).

Por defecto, cada archivo del buzón se borra solo después de **72 horas**
(se puede cambiar definiendo la variable de entorno `ENLACE_BUZON_HORAS` al
arrancar el servidor, por ejemplo `ENLACE_BUZON_HORAS=24 python3 server.py`
para que dure un día). También se puede borrar a mano en cualquier momento
con el botón "Borrar".

## Compartir la contraseña y las direcciones por correo

Como el puerto y (si expones el servidor) la dirección pública cambian cada
vez que arrancas Enlace, hay un panel en la pantalla de la anfitriona
("Compartir acceso por correo") para no tener que dictarlos a mano:

- **"Abrir en mi correo"**: siempre funciona, sin configurar nada. Arma un
  correo con las direcciones y la contraseña de esta sesión y lo abre en tu
  propia app de correo (Gmail, Outlook, la que tengas puesta por defecto)
  para que tú le des "Enviar". Enlace nunca ve tu contraseña de correo con
  este método.
- **"Enviar automáticamente"**: el propio servidor manda el correo sin que
  abras nada, pero necesita que definas una cuenta de correo emisora con
  variables de entorno antes de arrancar `server.py`:
  ```bash
  ENLACE_SMTP_HOST=smtp.gmail.com ENLACE_SMTP_PORT=587 \
  ENLACE_SMTP_USER=tucuenta@gmail.com ENLACE_SMTP_PASS="clave de aplicación" \
  python3 server.py
  ```
  Con Gmail hace falta una ["contraseña de aplicación"](https://myaccount.google.com/apppasswords),
  no la contraseña normal de la cuenta. Si no defines estas variables, el
  botón te avisa que no está disponible y te sugiere usar "Abrir en mi
  correo" en su lugar — Enlace sigue funcionando igual sin esto, es opcional.

## Qué incluye esta versión

- Conexión en tiempo real (WebSocket) entre cualquier cantidad de celulares
  y computadoras usando solo la IP de la anfitriona.
- **Varios dispositivos conectados a la vez, de cualquier tipo**: la
  anfitriona, otros celulares y otras computadoras se ven todos entre sí en
  una lista en vivo, y **cualquiera elige a cuál de los demás mandarle cada
  archivo** (ya no es solo "la PC decide" — cualquier dispositivo, incluidos
  los celulares y las PCs remotas, puede iniciar un envío hacia cualquier
  otro).
- **Envío global**: arriba de la lista de dispositivos hay una opción fija
  "🌐 Global — todos los conectados". Al elegirla, el mismo archivo se
  ofrece a todos los que estén conectados en ese momento de una sola vez —
  cada quien sigue viendo su propio aviso y decide aceptar o rechazar por
  su cuenta, igual que si se lo hubieran mandado a él solo. En la lista de
  transferencias de quien envía aparece una fila por destinatario, para ver
  el progreso de cada uno por separado.
- Lista de IPs guardadas con alias, en los dispositivos remotos (celular o
  PC secundaria).
- Arrastrar y soltar (o elegir con un toque), con barra de progreso en
  tiempo real.
- **Selección de varios archivos o una carpeta completa a la vez**: si
  eliges más de un archivo (o una carpeta), se empaquetan automáticamente en
  un `.zip` en el propio navegador y se mandan como un solo envío.
- **Vista previa antes de aceptar**: si te ofrecen una imagen o un video,
  ves una miniatura antes de decidir si aceptas o rechazas.
- **Reanudación automática**: si el WiFi se corta a la mitad de una
  transferencia, en cuanto la conexión vuelve retoma justo donde iba, sin
  reiniciar desde cero. Cada dispositivo se identifica con un ID permanente
  (no con su conexión de red, que cambia al reconectarse).
- **Sincronización de portapapeles**: cualquier dispositivo puede mandar el
  texto de su portapapeles a otro (o a todos los conectados a la vez).
  Quien lo recibe puede copiarlo a su propio portapapeles con un botón. Un
  dispositivo que se conecta más tarde recibe automáticamente el último
  valor compartido. Usa la Clipboard API del navegador, así que la primera
  vez puede pedir permiso.
- **Notificaciones nativas (fuera de la pestaña del navegador)**: al activar
  el permiso, Enlace avisa con una notificación del sistema operativo
  (Windows/macOS/Linux, o Android si se instaló como app) cuando llega un
  archivo o algo al portapapeles y no estás viendo la pestaña en ese
  momento. Se implementó con la Notification API + Service Worker, sin
  depender de un servidor de push por internet. *Limitación honesta*: esto
  funciona mientras la app/pestaña siga cargada, aunque esté en segundo
  plano o minimizada; si el usuario cierra la pestaña o la app por completo,
  no hay forma de avisarle sin un servicio de push real (VAPID/FCM), que
  requeriría acceso a internet y queda fuera del alcance de una app pensada
  para funcionar 100% en red local.
- Aviso en pantalla cuando se pierde o recupera la conexión, o cuando otro
  dispositivo se conecta o desconecta.
- Envío en cualquier dirección entre cualquier par de dispositivos.
- **Contraseña de acceso**: todo el sitio (páginas, envíos, buzón) está
  protegido por una sola contraseña que tú eliges; nadie entra sin
  escribirla, así sea en tu red o desde afuera.
- **Acceso desde afuera de tu red**: con un túnel (ngrok, Cloudflare Tunnel,
  Tailscale Funnel) o redirección de puertos en el router, se puede usar
  Enlace entre dispositivos que no están en la misma red WiFi (ver la
  sección de arriba).
- **Buzón**: una forma de mandar un archivo sin que el otro tenga que estar
  conectado en ese momento; queda guardado en el servidor un tiempo
  (configurable) para que lo descarguen después.
- **Compartir acceso por correo**: manda la dirección y la contraseña de la
  sesión actual a alguien de otra red, con un botón que abre tu propio
  correo (sin configurar nada) o, si lo configuras, uno que lo envía solo.
- **Apariencia distinta según el rol**: el panel de la anfitriona se ve como
  un tablero de control (colores cálidos, encabezado plano); los
  dispositivos invitados (celular u otra computadora) tienen su propio tema
  más "de app" (colores fríos, tarjetas redondeadas), y una computadora
  invitada aprovecha una pantalla ancha en vez de quedarse con el ancho
  pensado para celular.
- **Cierre limpio**: al cerrar Enlace (`Ctrl+C`, o si algo termina el
  proceso con `kill`), el servidor libera el puerto de inmediato y lo
  confirma en la terminal, para que puedas volver a arrancarlo sin errores
  de "puerto ocupado".
- **Arranque tipo app (doble clic)**: `iniciar.sh` instala lo que falte,
  arranca el servidor y abre solo el navegador ya en la dirección correcta
  — sin escribir comandos. Requisito único: tener Python instalado en esa
  computadora (los dispositivos que solo se conectan no necesitan nada de
  esto).
- **Contenedor Docker e IP fija**: `Dockerfile` / `docker-compose.yml` para
  correr Enlace empaquetado, con una IP fija tanto para el contenedor como
  para lo que Enlace muestra en pantalla (ver la sección dedicada más
  abajo).
- **Aplicación nativa de Linux**: `enlace.service` (systemd, arranque
  automático en segundo plano) y `Enlace.desktop` (ícono en el menú de tu
  escritorio) para dejar Enlace corriendo como servidor permanente (ver la
  sección dedicada más abajo).

Si prefieres correr Enlace dentro de Docker (por ejemplo en un NAS, un
servidor casero o para no instalar Python directo en la máquina), la
carpeta trae `Dockerfile` y `docker-compose.yml` listos.

1. Abre `docker-compose.yml` y edita las 3 líneas marcadas `<-- EDITA` (o
   los valores de `environment:` si no hay marca): tu contraseña en
   `ENLACE_PASSWORD`, y la IP real de esta máquina en tu red en
   `ENLACE_HOST_IP` (resérvala en tu router — "reserva DHCP por MAC" — para
   que no cambie nunca).
2. Arranca:
   ```bash
   docker compose up -d
   ```
3. Revisa la clave de acceso y las direcciones (por si no la fijaste):
   ```bash
   docker compose logs enlace
   ```
4. Para parar o reiniciar: `docker compose down` / `docker compose restart`.

`docker-compose.yml` también define una red Docker propia con una IP fija
para el contenedor (`172.28.0.10`, dentro de esa red interna). Esa IP fija
es útil para que otros contenedores o scripts siempre encuentren a Enlace
en el mismo lugar, pero **no es la IP que usan tu celular u otra PC de la
casa** — para eso publica el puerto al host (`ports:`, ya viene) y usa la
IP real del host en `ENLACE_HOST_IP`, como en el paso 1. Docker no puede
fijar la IP de tu red WiFi real, solo la de sus redes internas; la IP del
host se fija en el router o en la configuración de red del sistema
operativo.

Si prefieres correrlo suelto sin `docker-compose` (`docker build` +
`docker run`), el `Dockerfile` trae un ejemplo completo comentado arriba.

## Aplicación nativa en Linux (arranque automático, sin terminal abierta)

Para uso ocasional, `iniciar.sh` (doble clic) ya alcanza. Pero si vas a
dejar una computadora Linux como servidor permanente de Enlace en tu red
—con IP fija y sin depender de dejar una terminal abierta—, hay dos
opciones más, ambas ya incluidas:

- **Servicio de systemd (`enlace.service`)**: arranca solo con la
  computadora, sigue corriendo en segundo plano aunque cierres sesión, y
  se reinicia solo si llega a fallar. Instrucciones completas (qué editar
  y los comandos exactos) dentro del propio archivo `enlace.service`. En
  resumen:
  ```bash
  sudo cp enlace.service /etc/systemd/system/enlace.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now enlace.service
  ```
- **Lanzador de escritorio (`Enlace.desktop`)**: para que Enlace aparezca
  como una aplicación más en el menú de tu entorno de escritorio (GNOME,
  KDE, etc.), con su propio ícono, en vez de tener que ir a buscar la
  carpeta y hacer doble clic en `iniciar.sh`. Edita la ruta marcada
  `<-- EDITA` dentro del archivo y luego cópialo a
  `~/.local/share/applications/`.

Con cualquiera de las dos, define `ENLACE_HOST_IP` (variable de entorno)
con la IP fija de esa máquina en tu red, para que Enlace la muestre
correctamente en vez de tener que confiar en la detección automática —
particularmente importante si esa IP la reservaste tú mismo en el router
para que nunca cambie.

## Qué falta (siguientes pasos posibles)

- Código QR para conectar sin escribir la IP a mano.
- Persistencia de transferencias *en vivo* si se cierra por completo la
  app/pestaña (la reanudación actual funciona mientras la app siga abierta
  en segundo plano; cerrarla del todo sí reinicia el envío — el buzón no
  tiene este problema, porque no depende de que la pestaña siga abierta).
- Notificaciones con la app completamente cerrada, vía un servidor de push
  real (VAPID) — necesitaría salir de la red local a internet.
- Transferencia directa dispositivo-a-dispositivo (WebRTC) para no depender
  de que la anfitriona reenvíe cada fragmento; hoy todo pasa por el
  servidor central, que es más simple pero le pone un tope de velocidad
  igual al de esa computadora.
- HTTPS real (hoy es HTTP simple; un túnel tipo ngrok/Cloudflare sí agrega
  HTTPS automáticamente en el tramo público).

## Notas técnicas

- El servidor escucha en el puerto fijo **41823** por defecto. Si prefieres otro puerto, defínelo con la variable de entorno `ENLACE_PORT` en tu archivo `.env`.
- La IP que Enlace muestra en pantalla (para que celulares y otras PCs se
  conecten) se detecta sola por defecto. Si defines la variable de entorno
  `ENLACE_HOST_IP`, Enlace usa siempre esa IP en vez de detectarla —
  necesario para tener una IP fija de verdad (resérvala en tu router) y,
  sobre todo, obligatorio si corres Enlace dentro de Docker, porque ahí la
  detección automática encontraría la IP interna del contenedor, no la de
  tu red local (ver "Contenedor Docker" más abajo).
- La contraseña de acceso se define en `ACCESS_PASSWORD` al inicio de
  `server.py`, o con la variable de entorno `ENLACE_PASSWORD` (esta última
  tiene prioridad). La sesión iniciada en un navegador dura 30 días por
  defecto (`ENLACE_SESION_DIAS`); hay un enlace de "cerrar sesión" en cada
  pantalla si alguien quiere salir antes.
- Después de 6 intentos fallidos de contraseña seguidos desde la misma IP,
  esa IP queda bloqueada 5 minutos antes de poder volver a intentar (para
  dificultar que alguien pruebe contraseñas al azar).
- Los archivos del buzón quedan en la carpeta `buzon/` (se crea sola) y se
  borran automáticamente después de `ENLACE_BUZON_HORAS` horas (72 por
  defecto). El servidor revisa y limpia lo vencido cada 10 minutos, y
  también al arrancar.
- Si un dispositivo no logra conectarse, revisa que el firewall de la
  anfitriona no esté bloqueando conexiones entrantes al puerto que te
  muestre la terminal.
- La sincronización de portapapeles usa `navigator.clipboard`, que en la
  mayoría de navegadores requiere un "contexto seguro" (localhost o HTTPS).
  Conectarse por IP local normal (`http://192.168.x.x:<puerto>`) puede hacer
  que algunos navegadores (sobre todo en Android) restrinjan la lectura
  automática del portapapeles; en ese caso, sigue funcionando "enviar" lo
  que esté escrito en el cuadro de texto, y "copiar" con el botón dedicado.
- Para usar Enlace entre dispositivos que no están en la misma red WiFi
  (datos móviles, otra casa), la IP local sola no alcanza: hace falta un
  túnel tipo ngrok, redirección de puertos en el router, o una VPN — ver
  "Acceso desde afuera de tu red" más arriba. La contraseña de acceso es lo
  que hace razonable exponer el servidor de esa forma.


## Notas sobre ngrok (referencia rápida)

- Se configura una sola vez por computadora con `ngrok config add-authtoken TU_TOKEN`
  (el token se saca de tu cuenta en ngrok.com y se queda guardado ahí; no
  hace falta volver a pegarlo salvo que cambies de computadora o lo
  regeneres). Después, cada vez que quieras exponer Enlace corres
  `ngrok http <TU_PUERTO>` (ver la sección de arriba).
- Con la cuenta gratuita, la dirección pública cambia cada vez que cierras y
  vuelves a abrir el túnel; el túnel se mantiene activo mientras no lo
  cierres, no apagues la computadora ni se corte tu internet.
- El plan gratuito alcanza sin problema para un puñado de personas
  conectadas a la vez; no está pensado para cientos o miles de usuarios.
