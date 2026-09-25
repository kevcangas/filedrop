# 🚀 Guía de Inicio Rápido

Esta guía te muestra cómo poner en marcha Filedrop / Enlace en pocos minutos, tanto en tu computadora principal como conectando dispositivos móviles.

---

## 1. Requisitos Previos

- **En la computadora anfitriona (servidor)**:
  - Python 3.10 o superior (o Docker / Docker Compose).
  - Conexión a la red local (WiFi o Ethernet).
- **En los dispositivos clientes (celulares, tablets u otras computadoras)**:
  - Cualquier navegador web moderno (Chrome, Firefox, Safari, Edge).
  - No requiere instalar Python ni ninguna aplicación nativa.

---

## 2. Configuración Inicial

1. Clona o descarga el repositorio:
   ```bash
   git clone https://github.com/kevcangas/filedrop.git
   cd filedrop
   ```

2. Crea tu archivo de entorno a partir del ejemplo:
   ```bash
   cp .env.example .env
   ```

3. Abre el archivo `.env` con un editor de texto y define tu contraseña fija:
   ```env
   ENLACE_PASSWORD=mi-clave-super-secreta
   ```
   *(Si dejas esta variable vacía, Enlace generará una clave aleatoria al arrancar y la mostrará en la terminal).*

---

## 3. Ejecución del Servidor

### Opción A: Modo Fácil (Script con Auto-Navegador)
- **En Linux / macOS**: Ejecuta `./iniciar.sh` en tu terminal o haz doble clic sobre el script.
- Este script instalará automáticamente las dependencias si no están presentes y abrirá el navegador en la URL correspondiente.

### Opción B: Ejecución Manual con Python
```bash
# Crear entorno virtual (opcional pero recomendado)
python3 -m venv venv
source venv/bin/activate    # En Windows: .\venv\Scripts\activate

# Instalar dependencias
pip install -r requirements.txt

# Iniciar servidor
python3 server.py
```

### Opción C: Ejecución con Docker Compose
```bash
docker compose up -d
```
Para ver los registros y la clave de acceso generada:
```bash
docker compose logs -f enlace
```

---

## 4. Conectar Dispositivos

Al iniciar, la terminal imprimirá un cuadro informativo con las URLs de acceso:

```
============================================================
Enlace corriendo
   Esta computadora (anfitriona): http://localhost:41823/
   Celular (misma WiFi):          http://192.168.1.50:41823/mobile
   Otra computadora (misma WiFi): http://192.168.1.50:41823/desktop
   Clave de acceso:               tu-clave
   Puerto del servidor:           41823
============================================================
```

### En Celulares (Android / iOS):
1. Conéctate a la misma red WiFi que la computadora anfitriona.
2. Abre el navegador en `http://<IP_LOCAL>:41823/mobile`.
3. Introduce la contraseña de acceso.
4. **Instalación como App**: En el menú del navegador, selecciona **"Agregar a la pantalla de inicio"** (o "Instalar app"). ¡Listo! Se abrirá como una aplicación nativa sin barra de direcciones.

### En Otras Computadoras:
1. Abre `http://<IP_LOCAL>:41823/desktop` desde el navegador.
2. Introduce la contraseña y comienza a transferir archivos o compartir el portapapeles.
