# Evaluación de Ofertas — Framework de Scoring

Framework canónico para evaluar el encaje de una oferta con el perfil de Victor.
Usado por /job-apply (paso 1), /job-rank (batch) y el digest matutino.

## Dimensiones y pesos

| Dimensión | Peso | Qué evalúa |
|-----------|------|-----------|
| Ubicación | 25% | Tiers de ubicación (ver abajo) |
| Encaje de rol | 25% | Match con roles objetivo |
| Skills técnicos | 20% | Requisitos técnicos vs perfil (gaps honestos) |
| Sector | 15% | Bonus/penalización por sector |
| Nivel económico | 10% | Salario/rate declarado vs referencia |
| Idioma/cultura | 5% | IT/ES nativo, EN profesional |

## Tiers de ubicación (lo que manda es el TIEMPO REAL de commute, no los km)

| Tier | Criterio | Score ubicación |
|------|----------|-----------------|
| A+ | Casalecchio di Reno + Bologna ciudad (commute corto real) | 10 |
| A | Ciudad italiana CON MAR (relocation con ganas): Rimini, Livorno, Genova, Bari, Nápoles, Cagliari, Ravenna, Pescara... | 9 |
| B+ | Remoto (España, Italia o internacional) | 8 |
| B | España presencial cerca del mar (Barcelona, Valencia, Málaga, Alicante) — solo si la oferta es muy buena | 6 |
| C | Interior italiano a >45-60 min de commute (Modena, Imola, Reggio Emilia, Parma, Firenze) — casi nunca; regla: "si son 1-2h de tráfico, prefiero mudarme al mar", C nunca gana a A | 3 |
| VETO | Milán, Roma, Turín, cualquier presencial interior lejano | 0 (descarte automático) |

## Encaje de rol (roles objetivo, en orden de preferencia)

Score 9-10: Responsabile IT / IT Manager / Technology Advisor (PMI o industria)
Score 8-9: Digital Transformation Manager, Responsabile Soluzioni Digitali, IT/OT Specialist
Score 7-8: AI Automation Consultant, AI Solutions Consultant, Energy Manager / EGE (combina IT + TEE)
Score 5-6: BI Manager, Data Manager con componente de gestión
Score <5: puro desarrollador, puro comercial, roles junior

## Bonus de sector

| Sector | Efecto |
|--------|--------|
| Protección ambiental/animal, ecosistemas marinos (ONGs, acuarios, institutos oceanográficos, blue economy) | MÁXIMO: +2 puntos al score final; puede elevar tier B a APLICAR. Narrativa real: WHOI Voyager Member, La Guarida (11 años acuarios), geología |
| Manufactura E-R, energía/eficiencia (TEE/Certificati Bianchi), packaging/automotive (Motor Valley), tech/consultoría general | ALTO: +1 punto |
| Agroalimentaria, farma, otros | Neutro: 0 |

## Nivel económico

Referencia: Energy Manager full-remote Italia 50-60k€ (Michael Page).
Score 10: ≥60k€ o rate equivalente · 8: 50-60k€ · 6: 42-50k€ · 4: 35-42k€ · <4: <35k€
Si no se declara: score neutro 5 y anotar "salario no declarado — preguntar en primer contacto".

## Vetos automáticos (DESCARTAR sin más análisis)

1. Ubicación tier VETO
2. Requisito excluyente no cumplido: laurea en ingeniería completada obligatoria, certificaciones
   profesionales requeridas que Victor no tiene, años de experiencia excluyentes muy superiores
3. Presencial en ciudad sin mar a >1h de Casalecchio con oferta no excepcional

## Reglas de honestidad (inviolables)

- Un gap se DECLARA como gap en la recomendación y en la carta (framing de experiencia
  adyacente), nunca se maquilla ni se rellena.
- Ningún dato del CV/carta que no esté respaldado por perfil/01-perfil-candidato.md.

## Formato de salida (obligatorio)

```
OFERTA: <empresa> — <rol> (<portal>, <url>)
UBICACIÓN: <ciudad> → Tier <X> (<justificación: commute/mar/remoto>)
SCORE: <0-10> → VEREDICTO: APLICAR / APLICAR SI SOBRA TIEMPO / DESCARTAR

Fortalezas (3):
1. ...
Gaps (3, honestos):
1. ...
Dimensión económica: <dato o "no declarado">
Notas: <ángulos de sector, narrativa marina si aplica, flags de urgencia/deadline>
```

## Calibración

Tras 10-15 aplicaciones con resultado registrado (/job-outcome), proponer ajuste de pesos
según qué perfiles de oferta consiguieron entrevistas reales.
