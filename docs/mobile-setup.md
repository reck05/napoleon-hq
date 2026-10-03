# Napoleon en el teléfono y en tus dos computadoras

La configuración preparada usa una conexión privada de Tailscale. Cada computadora ejecuta su propio Napoleon y Codex; desde el teléfono eliges en cuál trabajar. Tus archivos y las cuentas de Codex se quedan en cada equipo.

## 1. Conecta el teléfono

Instala [Tailscale](https://tailscale.com/download) en el teléfono y entra con **la misma cuenta que utilizas en las computadoras**. Activa la conexión. Entra en Tailscale también en este Mac; Napoleon preparará automáticamente su dirección HTTPS privada después del inicio de sesión. Encontrarás esa dirección en el panel **Tus computadoras**.

Abre esa dirección con Safari o Chrome. Para tener un icono, usa **Compartir → Añadir a pantalla de inicio** en iPhone o **Añadir a pantalla de inicio / Instalar aplicación** en Android.

## 2. Prepara la segunda computadora una sola vez

[Descarga Napoleon](https://github.com/reck05/napoleon-hq/archive/refs/heads/main.zip), descomprime el archivo y abre la carpeta `scripts`.

- En Mac, haz doble clic en **Preparar Napoleon.command**.
- En Windows, abre **Preparar Napoleon.cmd**.

El preparador compila la app, prepara Codex en tu cuenta si falta y activa el inicio automático. Si falta Node.js o Tailscale, abre su página de instalación y explica qué falta. Completa el inicio de sesión de Tailscale con la misma cuenta y completa la entrada en Codex en la página que abra el preparador. Esos inicios de sesión son personales y no se pueden sustituir desde otro dispositivo. Si macOS bloquea un archivo descargado, abre **Ajustes del Sistema → Privacidad y seguridad** y permite este preparador después de comprobar que lo descargaste del repositorio.

Con ambas computadoras conectadas, abre Napoleon de la segunda → **Tus computadoras → Mostrar código**. En Napoleon de la primera, añade la segunda con su dirección privada y esa clave. La clave permite controlar ese Napoleon: consérvala en privado. Desde el teléfono selecciona la computadora y el proyecto y escribe el trabajo que quieres terminar.

## 3. Déjalas disponibles sin encenderlas cada vez

En este Mac, Napoleon arranca al entrar en tu cuenta y mantiene el sistema despierto **mientras funciona y está conectado a la corriente**. Puedes apagar la pantalla. Deja la tapa abierta: cerrar un portátil puede forzar el reposo y cortar la conexión. Al pasar a batería retira esa protección en un máximo de20 segundos y conserva el comportamiento normal de reposo. El ajuste es temporal: desaparece al cerrar el servicio; no cambia permanentemente la energía del sistema.

En Windows, el preparador activa el inicio al entrar en tu cuenta. Para mantenerlo disponible, conéctalo a corriente y selecciona **Configuración → Sistema → Energía → Pantalla y suspensión → Cuando esté enchufado, poner el dispositivo en suspensión: Nunca**. La pantalla sí puede apagarse. El preparador no cambia automáticamente la configuración de energía de Windows.

Una computadora apagada no puede ejecutar tareas: debe estar disponible o despertarse antes. [Apple documenta la activación desde el reposo para acceso de red](https://support.apple.com/es-es/guide/mac-help/mh27905/mac), pero esto no garantiza que Tailscale despierte el Mac ni que funcione con la tapa cerrada. Encender a distancia equipos compatibles con Wake-on-LAN exige [un dispositivo que permanezca encendido en la misma red](https://tailscale.com/blog/wake-on-lan-tailscale-upsnap). Si necesitas que las dos estén apagadas, el trabajo tendría que ejecutarse en un servidor siempre disponible con copias de tus proyectos.

## Comprobaciones y deshacer

Estas opciones sirven para quien te ayuda a administrarlo; el uso diario se hace desde la app:

```bash
node scripts/mobile-setup.mjs status
node scripts/mobile-setup.mjs configure --allow-sleep
node scripts/mobile-setup.mjs configure --keep-awake
node scripts/mobile-setup.mjs remove-autostart
```

`status` muestra si Codex está conectado, si Napoleon responde y qué computadoras ve Tailscale. El servicio comprueba la conexión cada20 segundos: tras entrar en Tailscale activa HTTPS privado y reinicia únicamente Napoleon para aplicar la dirección. Si HTTPS necesita habilitarse en tu cuenta, Tailscale mostrará la acción necesaria; el servicio volverá a intentarlo automáticamente. No reemplaza servicios existentes ni usa Funnel público.

La configuración y los registros están en `~/.codex/napoleon/`: `setup.json`, `mobile.json`, `service.log` y `service-error.log`. La clave para unir equipos y el catálogo también permanecen fuera del repositorio. El inicio automático requiere que tu sesión haya arrancado; no evita la contraseña del arranque ni el desbloqueo de FileVault.

[Documentación oficial de Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve).
