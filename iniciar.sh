#!/bin/bash
# Arranca Enlace en Linux. Doble clic si tu administrador de archivos lo
# permite ("Ejecutar" en vez de "Abrir con"), o desde una terminal:
#   ./iniciar.sh

cd "$(dirname "$0")"

echo "============================================================"
echo " Enlace - iniciando..."
echo "============================================================"
echo

if command -v python3 >/dev/null 2>&1; then
    PYCMD=python3
else
    echo "No se encontro Python 3 instalado en esta computadora."
    echo "Instalalo con el gestor de paquetes de tu distribucion, por ejemplo:"
    echo "  sudo apt install python3 python3-pip      (Debian/Ubuntu)"
    echo "  sudo dnf install python3 python3-pip       (Fedora)"
    read -p "Presiona Enter para salir..."
    exit 1
fi

echo "Instalando/actualizando lo que hace falta (solo tarda la primera vez)..."
"$PYCMD" -m pip install --quiet --disable-pip-version-check --break-system-packages -r requirements.txt \
  || "$PYCMD" -m pip install --quiet --disable-pip-version-check -r requirements.txt
if [ $? -ne 0 ]; then
    echo
    echo "Hubo un problema instalando los requisitos. Revisa tu conexion a"
    echo "internet e intenta de nuevo."
    read -p "Presiona Enter para salir..."
    exit 1
fi
echo "Listo: los requisitos de Python ya estan instalados."

echo
echo "Arrancando Enlace... en un momento se abre solo en tu navegador."
echo "(Deja esta terminal abierta mientras uses Enlace. Para cerrarlo,"
echo " presiona Ctrl+C.)"
echo

"$PYCMD" server.py

echo
echo "Enlace se cerro."
read -p "Presiona Enter para salir..."
