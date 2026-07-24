# Fase 3: Digest diario

El plist es una plantilla para el Mac Mini. No se instala automáticamente
porque la ruta del workspace y la sesión de OpenCode deben verificarse en ese
equipo.

## Instalación manual

1. Verifica que el repositorio existe en
   `/Users/victorblanco/Documents/ai-job-search` del Mac Mini, o modifica las
   dos rutas absolutas del plist y el workspace usado por el script.
2. Comprueba que `SECONDBRAIN_SSH` y `SECONDBRAIN_PATH` están en `.env` y que
   `scp` funciona con una prueba controlada.
3. Ejecuta manualmente `tools/daily_digest.sh` una vez y revisa el digest local
   y los logs antes de activar launchd.
4. Instala y activa la plantilla:

```bash
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp ops/com.victor.ai-job-search.digest.plist "$HOME/Library/LaunchAgents/"
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.victor.ai-job-search.digest.plist"
```

Para una ejecución manual posterior:

```bash
launchctl kickstart -k "gui/$(id -u)/com.victor.ai-job-search.digest"
```

El job se ejecuta a las 07:00, usa una carpeta lock para evitar solapamientos y
deja la decisión de aplicar bajo revisión manual. `--auto` solo se usa para los
dos comandos fijos `/job-scrape` y `/job-rank` dentro del wrapper; esos workflows
mantienen sus propios límites y gates de seguridad.

Si el vault no está disponible, la cola local queda en
`tracker/secondbrain-queue/`; revísala y vuelve a ejecutar el digest desde el
mismo equipo cuando SSH vuelva a estar disponible. La cola está gitignored y
no sustituye una copia de seguridad.
