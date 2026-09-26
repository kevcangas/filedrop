# 🚀 Guía de Inicio Rápido

Esta guía te muestra cómo poner en marcha **Enlace (Filedrop)** en pocos minutos, registrar tu cuenta, vincular tus dispositivos y comenzar a compartir archivos y portapapeles con amigos.

---

## 1. Requisitos Previos

- **En la computadora anfitriona (servidor)**:
  - **Recomendado**: Docker y Docker Compose (incluye PostgreSQL automáticamente).
  - **O manual**: Python 3.10+ y PostgreSQL 16 local.
- **En los dispositivos clientes (celulares, tablets o PCs)**:
  - Cualquier navegador web moderno (Chrome, Safari, Firefox, Edge).
  - No requiere instalar Python ni clientes nativos.

---

## 2. Configuración Inicial

1. Clona el repositorio:
   ```bash
   git clone https://github.com/kevcangas/filedrop.git
   cd filedrop
   ```

2. Genera tu archivo `.env`:
   ```bash
   cp .env.example .env
   ```

3. Revisa los valores en `.env` (las contraseñas y base de datos por defecto vienen listas para desarrollo local en Docker).

---

## 3. Ejecución del Servidor

### Opción A: Con Docker Compose (Recomendada)
Esta opción arranca tanto el servidor web como PostgreSQL con comprobación de salud automática:
```bash
docker compose up -d
```
Para ver los registros y confirmar el inicio:
```bash
docker compose logs -f enlace
```

### Opción B: Ejecución Manual con Python y PostgreSQL Local
```bash
# 1. Crear y activar entorno virtual
python3 -m venv venv
source venv/bin/activate    # En Windows: .\venv\Scripts\activate

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Aplicar migraciones a PostgreSQL
flask db upgrade

# 4. Iniciar servidor
python3 server.py
```

---

## 4. Primeros Pasos: Registro, Dispositivos y Amigos

Al abrir `http://localhost:41823/` (o la IP local del host en tu red):

### Paso 1: Crear tu Cuenta y Nombrar tu Dispositivo
1. En la pantalla de bienvenida, selecciona la pestaña **"Crear Cuenta"**.
2. Ingresa tu usuario, correo electrónico y contraseña segura.
3. Elige un nombre descriptivo para este dispositivo (ejemplo: *"Laptop Personal"*).
4. Haz clic en **"Registrarse"**. El sistema creará tu cuenta, registrará el dispositivo y abrirá la consola principal.

### Paso 2: Conectar un Celular u Otro Dispositivo Propio
1. Abre el navegador de tu celular en la misma red WiFi: `http://<IP_LOCAL>:41823/mobile`.
2. Inicia sesión con **la misma cuenta** que creaste antes.
3. Asigna un nombre al dispositivo (ejemplo: *"iPhone de Kevin"*).
4. Ambos dispositivos aparecerán mutuamente en la lista con el distintivo **"Mis Dispositivos"**. El intercambio de archivos y sincronización de portapapeles entre dispositivos propios es directo e inmediato.

### Paso 3: Invitar y Conectar Amigos
1. Haz clic en el botón **"Amigos"** (o ícono de usuario) en la barra superior para abrir el panel lateral de amigos.
2. Escribe el **nombre de usuario** de tu amigo y haz clic en **"Enviar Solicitud"**.
3. Tu amigo verá la solicitud entrante en su panel y podrá **"Aceptar"**.
4. A partir de ese momento, los dispositivos activos de tu amigo aparecerán en tu lista en tiempo real para enviarles archivos en vivo con vista previa interactiva.

---

## 5. Instalación como Progressive Web App (PWA)

- **En Android / iOS**: En el menú de opciones del navegador (o botón compartir en iOS), pulsa **"Agregar a pantalla de inicio"** (o "Instalar app").
- **En Chrome / Edge (Escritorio)**: Haz clic en el ícono de instalación en el extremo derecho de la barra de direcciones.
- Enlace se comportará como una aplicación nativa de escritorio o móvil, con ventana independiente y notificaciones del sistema.
