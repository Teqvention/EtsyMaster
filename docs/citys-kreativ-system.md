# Citys: das Kreativ-System (Levels, Sky, Stil-Treue, Sets, Produce)

**Stand:** 12.10.2026. Wie ein Citys-Bild entsteht und warum. Code: `src/lib/citys/prompts.ts` (alle Texte für
Gemini und Nano Banana), `skies.ts` (die Himmel), `generate.ts` (was pro Referenz gemalt wird), `produce.ts`
(Produktionen), `briefs.ts` (Orts-Briefings). Die Oberfläche: Stealer → „… per photo“, Stil-Seite → „Produce cities“.

## 1 · Das Wichtigste

1. **Jedes Bild muss ein Poster sein, das man sich aufhängt.** Hell, luftig, warm, einladend. Nie dunkle oder
   dramatische Himmel, keine Nacht, keine schwere Wolkendecke, kein grelles Orange (Regeln: `SKY_RULES`).
2. **Standard: Das Bild behält das Medium der Referenz.** Ein Sketch ergibt Sketches, ein Aquarell Aquarelle, ein Foto
   Fotos. Die Referenz wird dafür einmal pro Set gelesen (`readReference`: Foto oder Kunst, wie gemacht, was sie zeigt,
   was sie verkauft).
3. **Schalter „Real photos“:** an = alles wird ein echtes Foto, auch aus einer Illustration (Komposition und Ort aus der
   Referenz, nichts von der Zeichnung).
4. **Stile sind Foto-Look oder Kunst.** Beim Einlesen entscheidet Gemini `photo` oder `art`. Ein Foto-Stil (z. B.
   „real vintage“) macht immer echte Fotos in genau dieser Farbgebung, auch aus einer Cartoon-Referenz. Ein Kunst-Stil
   macht genau seine Kunst (Linie, Palette, Textur) — man soll nicht erkennen, welches Bild neu ist.
5. **Jeder Ort hat ein Briefing** (`citys/briefs/<placeId>`): Wahrzeichen, Poster-Motive (London: Big Ben + roter Bus),
   Geografie, Aussichtspunkte. Damit treffen New ideas, Sets und Produktionen den Kern der Stadt.

## 2 · Die fünf Creativity-Level

| Level | Foto | Kunst (Referenz-Stil) |
| --- | --- | --- |
| 1 Faithful | Dasselbe Foto noch mal: kleine echte Unterschiede (weniger Autos, Palmen im Wind), Himmel minimal schöner | Dieselbe Zeichnung neu gezeichnet: andere Figuren/Autos, kleine Details |
| 2 Refined | Gleiche Ansicht, schöner Himmel, sauberes Licht, Störendes weg | Gleiche Ansicht, ein paar Änderungen mehr |
| 3 New light | Gleiche Ansicht, anderer schmeichelnder Moment (Golden hour, Blush, sonniger Morgen) — nie Nacht | Neu arrangiert, anderes Licht, gleich hell wie die Referenz |
| 4 New angle | Nahe echte Perspektive, als Poster komponiert; behält, was die Referenz schön macht | Nahe Ansicht, gleicher Charakter |
| 5 Signature | Unsere schönste Fassung des Ortes: freiere Komposition, ruhig und elegant, nie laut | Die Komposition eines Top-Illustrators, gleicher Stil |

## 3 · Sky

Eine Sky-Wahl pro Reihe; sie gilt für alle Level der Reihe. Mit „+“ kommt eine zweite (dritte) Reihe mit eigenem Sky.
New ideas und das Set nehmen den Sky der ersten Reihe.

- **Open** (Standard): Wir wählen, was das Bild am schönsten macht — oft den eigenen Himmel der Referenz, nur schöner.
- **Blush pink** (rosa → weiß), **Golden hour** (dezent, Fassaden golden angeleuchtet), **Turquoise** (aqua Himmel,
  türkises Wasser, luftig), **Sunshine** (blauer Sommertag, optional kleine Wölkchen), **Peach & blue**,
  **Cotton candy** (rosa-lila Wölkchen), **Lilac dusk**, **Soft morning**.

## 4 · Autonom, New ideas, Set of 3

- **Autonomous** (1, 2 oder 3 pro Foto): Gemini schaut jedes Foto an und wählt Level und Sky selbst — meist subtil
  (1–3), Level 4 nur wenn eine nahe Perspektive klar schöner wird, 5 selten. Die Varianten unterscheiden sich.
- **New ideas:** neue Kompositionen der Stadt im Look der Referenz (ein anderes Wahrzeichen, ein anderer Blick),
  mal nah an der Art der Referenz, mal freier.
- **Set of 3** (Slider 3–9, zusätzlich zu allem): ein Set, das zusammen hängt. Die ersten drei zeigen drei
  verschiedene Kern-Motive (New York: Skyline, Central Park, Freiheitsstatue), der Rest kreative Varianten.

## 5 · Produce cities (auf einer Stil-Seite)

Ein Stil über eine Liste von Orten: Schnellwahl (Top 100 Städte, Top 50 · Set of 3, 30 beste noch offene, Top 20
Strände & Inseln, Top 20 Natur) oder Filter (Tier, Setting, Tags, „noch nicht unsere“, Top N, Suche). Pro Ort ein
Set (3–9) und/oder Einzelposter. Kompositionen: **100 % Freiheit** oder **nach Bestsellern** (Low/Mid/High — wie eng
wir den meistverkauften Postern des Ortes folgen; die Bestseller-Bilder sieht nur der Art Director). Alles landet in
Outputs unter dem Stil, jede Produktion als eigene Gruppe (`/citys/outputs?group=production:<id>`).

## 6 · Tests vom 12.10. (alle „Now“, Nano Banana 2.1)

**Welle 1 (19 Bilder, 0 Fehler):** NYC-Straße (Foto) Level 1–3 + Level 4 Blush, Honolulu autonom ×2 + Level 5
Golden hour, Riviera (Aquarell-Referenz) Level 1/3 + 2 New ideas, NYC-Sketch Level 1–3 + 2 New ideas + Set of 3.
- Sketch bleibt Sketch, Aquarell bleibt Aquarell (vorher kamen aus beiden Fotos). New ideas/Set treffen den Stil
  (Brooklyn Bridge, Freiheitsstatue, Central Park, Nizza, Èze), Schilder im Stil der Referenz.
- Autonom wählte für Honolulu Level 2 · Peach und Level 3 · Blush — beide subtil und hell.
- Korrigiert: Riviera Level 3 wurde oben dunkelblau („Twilight“) → Kunst-Level bleiben jetzt so hell wie die Referenz.
  NYC Level 4 wechselte in eine andere Straße ohne Bäume → Level 4/5 behalten jetzt, was die Referenz schön macht.
- Korrigiert: Die Briefings der Varianten griffen Wahrzeichen aus dem Orts-Briefing auf (Diamond Head statt Mokoliʻi)
  → Varianten bekommen nur noch die Referenz, das Orts-Briefing nur New ideas, Sets und Stile.
- Korrigiert: New idea und Set wählten beide das Flatiron Building → diese Gruppen werden nacheinander geplant und
  sehen die Motive der anderen.

**Welle 2 (19 Bilder, 0 Fehler):** „real vintage“ (Foto-Look) auf Sketch, Aquarell und Foto → jedes Mal ein echtes
Foto im Film-Look mit der Komposition der Referenz. Real-photo-Schalter auf dem Sketch → echte Fotos derselben
Straßenszene. Pink sketch auf Honolulu und NYC → Sketches. Produktion Pink sketch: London (Big Ben + roter Bus,
St Paul's + Telefonzelle, Tower Bridge), Sydney (Opera House, The Rocks, Bondi Icebergs), Rome, Paris (nach
Bestsellern, Mid).
- Korrigiert: Die neuen Sketches waren sauberer und detaillierter als das Original (dem fehlen dann der wackelige
  Strich, die Buntstift-Struktur, das kräftige Pink) → Kunst wird jetzt als „nächstes Poster derselben Serie, von
  derselben Hand“ gemalt, nie sauberer oder detaillierter als die Vorlage.

**Welle 3 (16 Bilder, 0 Fehler), Prüfung der Korrekturen:**
- Honolulu autonom: Level 2 · Turquoise und Level 3 · Blush, Titel und Briefings jetzt bei Mokoliʻi.
- Riviera Level 3: hell mit Blush-Himmel statt dunkler Dämmerung.
- NYC Level 4 (Sunshine): vom Tudor-City-Balkon mit Blumen über dieselbe Allee — gleiches Motiv, besser komponiert.
- NYC-Sketch: New ideas und Set ohne Doppel-Motiv (Times Square, Grand Central, Lower Manhattan, Washington Square,
  Chrysler).
- Produktion „real vintage“ Santorini (ohne Referenz): drei echte Fotos im Film-Look (Oia, Windmühlen, Fira).
- Produktion Pink sketch Amsterdam: Grachten mit Rädern, Magere Brug, Rijksmuseum.
- Korrigiert: Times Square zeigte „WICKED“ und ein McDonald's-Logo → Schilder nur noch generisch (Straßen-/Ortsnamen,
  CAFE, HOTEL), nie Marken, Shows oder Logos; auch echte Fotos ohne lesbare Marken.
- Nachgeschärft: Strichstärke wie in der Vorlage (so dick, so dunkel, so wenige Linien), belebte Szenen vereinfacht.

**Welle 4 (13 Bilder, 0 Fehler):** neue Foto-Referenz Amalfi (Atrani): autonom → Level 1 · Golden (fast wie das
Original, warmes Licht) und Level 2 · Blush; Level 4 von einer Terrasse mit Bougainvillea; Level 5 · Cotton candy
(rosa-lila Wölkchen, ruhig); Set of 3: Positano, Ravello (Pinien), Marina Grande. Produktion Pink sketch Venedig
(Gondel am Rialto, Markusplatz, Salute) und Lissabon (Tram 28, Belém, Praça do Comércio).

**Insgesamt 67 Sync-Bilder, 0 Fehler.** Danach Sync auf 2 parallele Aufrufe gesenkt (`MAX_PARALLEL` in
`src/lib/mockups/gemini.ts`, wie in `google-bilder-batch-sync-wissen.md`). Noch offen: Die Kunst-Treue bei sehr
lockeren Stilen (der Pink-Sketch hat dickere, wackeligere Linien als unsere Bilder) und die Marken-Regel
(nach Times Square eingeführt) sind noch nicht in einer weiteren Welle geprüft.
