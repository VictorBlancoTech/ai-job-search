# Plantilla CV — Awesome-CV (reglas para /job-apply)

## Archivos
- Masters reales (gitignored): `cv/victor-cv-master-{it,es,en}.tex` + `cv/awesome-cv.cls`
- Plantilla con placeholders (commiteada): `cv/plantilla/`
- Foto: `cv/profile.png` (si existe)

## Compilación
- Motor: **xelatex** (la clase awesome-cv requiere fontspec). Comando:
  `cd cv && xelatex -interaction=nonstopmode <archivo>.tex`
- Verificación obligatoria post-compilación: leer el PDF renderizado.

## Reglas de tailoring (para /job-apply)
1. Base: el master del idioma de la oferta (IT/ES/EN). Nunca traducir suelto: partir del master.
2. Longitud: máximo 2 páginas. Si supera, corte por relevancia: score cada línea candidata por
   (a) keywords de ESTA oferta, (b) unicidad en el documento, (c) dependencia de la carta.
   Cortar la de menor score total primero. Nunca cortar mecánicamente "lo más viejo".
3. Mantener el orden de secciones del master italiano: Profilo → Risultati chiave →
   Esperienza → Competenze → Formazione → Lingue → Volontariato → GDPR.
4. Keywords de la oferta: usar el término exacto de la oferta cuando sea veraz
   ("Responsabile IT" si la oferta lo dice), preferir bullets de experiencia sobre el
   profile statement para añadirlas.
5. Foto: Awesome-CV la soporta; en Italia es aceptada, en UK/US quitarla. Regla: mantener
   la configuración del master del idioma correspondiente.
6. Nada de claims no respaldados por perfil/01-perfil-candidato.md.

## Output de /job-apply
- Archivo: `cv/victor_<empresa>_<rol>.tex` (+ .pdf compilado)
- La copia final se archiva también en `tracker/aplicaciones/<empresa>_<rol>/` (Fase 3).
