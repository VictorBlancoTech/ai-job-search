# AI Job Search (fork de Victor)

Sistema personal de búsqueda de empleo sobre OpenCode. Fork podado y adaptado de
[MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search) (MIT).

- **Scoring de fit** con tiers de ubicación (Bologna/costa IT/remoto) y bonus de sector (protección marina y ambiental).
- **CV Awesome-CV** propio (IT/ES/EN) con verificación de PDF y capa de texto ATS.
- **Cartas** en Markdown (canónico) + LaTeX bajo demanda.
- **Tracker** CSV + notas en SecondBrain.

## Uso

1. `.env` con credenciales (ver `AGENTS.md` y spec en `docs/`).
2. `/job-setup` — importa/verifica el perfil.
3. `/job-scrape` y `/job-rank` — buscan y puntúan ofertas.
4. `/job-apply <url o texto>` — pipeline completo: scoring → CV → carta → review → PDF + ATS check.
5. `/job-outcome` — registra aplicaciones, resultados y seguimiento.

## Tests

```bash
pytest tests/ -v && python tools/lint_skills.py && python tools/security_guards.py
```

Spec y plan: `docs/superpowers/`.
