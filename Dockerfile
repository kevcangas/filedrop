# Enlace - imagen de contenedor
# ------------------------------------------------------------------
# Construir:
#   docker build -t enlace .
#
# Correr suelto (sin docker-compose), publicando el puerto fijo 41823
# y fijando la clave de acceso y la IP que se muestra en pantalla:
#   docker run -d --name enlace \
#     -p 41823:41823 \
#     -e ENLACE_PORT=41823 \
#     -e ENLACE_PASSWORD=tu-clave-secreta \
#     -e ENLACE_HOST_IP=192.168.1.50 \
#     -v enlace_uploads:/app/uploads \
#     -v enlace_buzon:/app/buzon \
#     enlace
#
# Para una IP de contenedor fija de verdad (no solo la que se muestra en
# pantalla, sino la IP real dentro de una red Docker), usa
# docker-compose.yml en vez de "docker run" (ver ese archivo).
# ------------------------------------------------------------------

FROM python:3.12-slim

# Sin esto, Flask/Socket.IO igual funcionan, pero los mensajes en la
# terminal (acentos, etc.) se ven mal en algunos entornos.
ENV PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    ENLACE_NO_BROWSER=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# uploads/ y buzon/ son donde Enlace guarda archivos: se declaran como
# volumenes para que sobrevivan si el contenedor se recrea, y para poder
# montarles un volumen nombrado o una carpeta del host desde afuera.
RUN mkdir -p /app/uploads /app/buzon
VOLUME ["/app/uploads", "/app/buzon"]

# Dentro del contenedor SIEMPRE corre en el puerto 41823 (fijo, ver
# ENLACE_PORT abajo); lo que cambia entre entornos es a qué puerto del
# host lo publicas con "-p" o en docker-compose.yml.
ENV ENLACE_PORT=41823
EXPOSE 41823

# Nunca corre "de fabrica" con la contraseña de ejemplo: si no defines
# ENLACE_PASSWORD al arrancar el contenedor, Enlace genera una aleatoria y
# la imprime en "docker logs enlace" (igual que fuera de Docker).
CMD ["python3", "server.py"]
