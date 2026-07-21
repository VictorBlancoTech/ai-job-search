# /setup - Onboarding y calibración del perfil

Configuras o actualizas el perfil de `perfil/`. Argumentos opcionales en `$ARGUMENTS`:
`--section search` (solo reconfigurar queries) o `--section <archivo>` (solo esa sección).

## Detección de modo (si no hay --section)

1. **Si `perfil/01-perfil-candidato.md` ya existe y tiene contenido:** modo VERIFICACIÓN.
   Resume en 5 líneas lo que hay y ofrece: (a) completar huecos marcados
   `[COMPLETAR en /setup]`, (b) actualizar una sección, (c) nada, salir.
2. **Si no existe:** modo IMPORTACIÓN. Fuentes, en orden de preferencia:
   - **A. Awesome-CV:** `/Users/victorblanco/Documents/Awesome-CV/instrucciones.md`
     (fuente principal aprobada) + masters en `cv/`.
   - **B. documents/:** CV PDF, export LinkedIn, diplomas, referencias si existen.
   - **C. Entrevista:** preguntas una a una si no hay material.

## Huecos a completar con entrevista breve (uno por mensaje)

- `perfil/02`: áreas de crecimiento; assessment formal si lo tiene (PI/DISC) o autoevaluación guiada.
- `perfil/01`: "qué drena"; expectativas económicas mínimas (para dimensión económica de 04);
  disponibilidad (inizio, preavviso).
- Confirmar los tiers de ubicación con ejemplos límite ("¿Ferrara es A+ o C?" — medir por
  tiempo de commute, no km).

## --section search

Reconfigurar `perfil/search-queries.md`: roles objetivo, keywords, ubicaciones, portales.
Sugerir roles no considerados basándote en el perfil (ej. EGE/Energy Manager combina
IT + TEE y tiene demanda full-remote 50-60k€).

## Reglas

- Nunca escribas datos inventados; lo que no esté en las fuentes se pregunta.
- `perfil/01-perfil-candidato.md` contiene datos personales: está gitignored, no lo
  muestres en output de git ni lo copies a archivos commiteados.
- Al terminar: resumen de qué se escribió dónde + recordatorio de que `04` (scoring)
  se calibra solo tras 10-15 outcomes.
