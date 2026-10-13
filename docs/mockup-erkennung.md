# Automatische Mockup-Erkennung

Stand 13.10.2026. Betrifft jeden Weg, auf dem aus einem fremden Mockup eine Szene wird: „Generate from reference…“, gestohlene Mockups (Generation-Sets aus Saved/Stealer), „Regenerate“ und neu der Editor-Knopf **Detect frames again** (Lupen-Symbol in der Werkzeugleiste).

## Ablauf

1. **Blank**: Nano Banana malt das Foto 1:1 nach, die Bilder in den Rahmen werden leeres weißes Papier. Was vor dem Bild steht (Hand, Bücher, Lampe), bleibt im Blank stehen (unverändert).
2. **Ein Blick von Gemini Flash auf den Blank** (`guessScene` in `src/lib/mockups/gemini.ts`): Boxen aller Blätter (auch teilweise verdeckt, gekippt, angeschnitten, in der Hand gehalten) **und** Boxen von allem, was vor einem Blatt steht, mit Bezeichnung („hand“, „books“, „lamp“, „chair“, „frame“ …).
3. **Gegenprobe am Original** (falls vorhanden, parallel): Gemini sucht die Drucke im Originalfoto. Ein Druck, zu dem im Blank kein Blatt gefunden wurde und dessen Fläche im Blank wie leeres Papier aussieht, wird als weiteres Blatt übernommen. So geht bei Sets kein Rahmen verloren.
4. **Pixel-Arbeit** (`src/lib/mockups/detect.ts`, ohne KI):
   - Strahlen von der Blattmitte nach außen bis zum ersten Pixel, das kein Papier mehr ist (viel dunkler oder andere Farbe: Holz, Gold, schwarzer Rahmen). Treffer in Boxen von Dingen davor zählen nicht.
   - Je Seite eine robuste Gerade (RANSAC, bis 35° Neigung, also auch angelehnte und schief gehaltene Rahmen). Ecken = Schnittpunkte der Geraden, auch wenn die Ecke selbst verdeckt ist (Daumen, Bücher).
   - Zweiter Durchgang quer zu jeder gefundenen Kante: die innerste scharfe Stufe, hinter der Rahmen (nicht beschattetes Papier) liegt, Gerade durch die Mitte der Treffer.
   - Was das Original unverändert zeigt und klar kein Papier ist (an der Blattkante, groß genug), gilt als „davor“, auch wenn Gemini es nicht gemeldet hat; danach werden die Blätter noch einmal vermessen.
5. **„In front of poster“**: Innerhalb jedes Blatts wird in den Boxen der Dinge davor das Papier von außen „eingeflutet“, solange keine Kontur (Sobel) im Weg ist. Was das Papier nicht erreicht, ist das Objekt. Papier, wo das Original das Motiv zeigte, ist sicher Papier (z. B. zwischen den Stahlrohren eines Stuhls). Maske säubern (Krümel weg, Lücken zu), 1 px breiter, 1 px weicher Rand → eine Ebene **In front of poster** (Rolle `front`, Normal, 100 %) über den Postern, wie mit Reveal gemalt. Kein Objekt → keine Ebene.
6. **Licht und Spiegelung** werden aus dem Blank gelesen, in dem die Pixel unter der Maske vorher aus dem umliegenden Papier aufgefüllt wurden (Push-Pull). Unter einer Hand bleibt also kein handförmiger Schatten im Motiv.
7. Poster-Reihenfolge: Leserichtung; überlappen sich zwei Blätter, kommt das größere (nähere) später.

„Detect frames again“ ersetzt nur die Poster-Ebenen und eine früher automatisch erzeugte „In front of poster“-Ebene (Id `front-auto…`); selbst gemalte Front-Ebenen und alle anderen Ebenen bleiben. Ungespeicherte Änderungen gehen nach Rückfrage verloren.

## Gemessen an echten Mockups

Grundlage: alle 64 automatisch bzw. aus Vorlagen erzeugten Szenen der geteilten Datenbank (106 Blätter, 19 Szenen mit 2–6 Blättern), Blanks und Originalfotos aus Bucket und Generation-Sets. Für 7 Szenen echte Gemini-Boxen, für die übrigen die Boxen der alten Ergebnisse um 1,5 % vergrößert (simuliert Geminis Ungenauigkeit). Übersichten (alt cyan, neu magenta, Front-Maske rot) und Eck-Nahaufnahmen liegen im Scratchpad der Sitzung (`det/before/`, `det/after8-sheets/`, `det/corners-*.png`).

Deutlich falsch vorher, jetzt richtig:

| Szene | vorher | jetzt |
|---|---|---|
| bathroom-wall-art (Rahmen ~20° schräg in Händen) | achsenparallele Box, Ecken bis ~21 % daneben | exaktes schräges Viereck, Finger auf dem Papier ausgeschnitten |
| set-of-3-dining-prints (zwei angelehnt, Bücher, Vase) | rechter Rahmen: Ecke ~17 % daneben; linker: Unterkante durch die Bücher verkippt | alle drei auf der Kante; Bücher + Vase vor dem Poster ausgeschnitten |
| set-of-3-dining-prints-5 (helle Holzrahmen nebeneinander) | zwei Kanten diagonal verzogen (~9 %) | alle drei Blätter auf den Innenkanten |
| colorful-dog-portrait (Bücher vor dem Rahmen) | Unterkante schräg durch die Bücher (~7 %) | gerade Unterkante, Bücher als Front-Ebene |
| disco-ball (Stahlrohrstuhl davor) | Poster über dem Stuhl | Rohre ausgeschnitten, Papier dazwischen bleibt Poster |
| funny-cats, zebra, trendy-tiger … (Lampe vor dem hinteren Rahmen) | Poster über der Lampe | Lampe ausgeschnitten |

- Front-Maske gegen die von Hand gebaute Vorlage „Bett weiße Wäsche“ (Lampe, Ball, Bücher; ohne Originalfoto): Überdeckung (IoU) **0,69**. Die Chromlampe ist vollständig, vom weißen Ball fehlt die helle Hälfte, zusätzlich markiert ist ein 1–2 % breiter Rahmenstreifen an der verdeckten Unterkante (sieht im Bild richtig aus, das Poster reicht dort nur unter den Rahmen).
- Ende-zu-Ende über den echten Code (Gemini + Speicher + Editor) geprüft an set-of-3-dining-prints: 3 Poster, gekipptes richtig, Front-Ebene mit Büchern/Vase, Editor rendert ohne Fehler. Testszenen („zz-test …“) danach gelöscht.
- Laufzeit der Pixel-Arbeit: 20 ms – 2,5 s je Mockup (4096 px mit großen Objekten am langsamsten).
- Google-Aufrufe: pro Mockup jetzt 2 Gemini-Flash-Blicke (Blank + Original, parallel) statt 1; keine zusätzlichen Bildaufrufe.

## Grenzen

- **Ohne Originalfoto** (Raum-Upload ohne Etsy-Quelle) fehlt die Gegenprobe: weiße oder spiegelnde Dinge vor dem Papier (weißer Ball, heller Lampenschirm) werden teils nicht ganz ausgeschnitten.
- **Ganz verdeckte Kante** (Bücher über die ganze Breite): die Kante kommt aus Geminis Box (~0,5–1 % ungenau).
- **Passepartout**: ob Papier oder Passepartout bespielt wird, hängt am Kontrast; bei cremefarbenem Passepartout auf weißem Papier kann eine Seite am Passepartout, die andere am Rahmen landen.
- **Hintere Rahmen hinter einem vorderen**: das Viereck endet an der sichtbaren Kante; der verdeckte Teil wird nicht ergänzt (das Motiv wird dort also nicht „angeschnitten“, sondern ganz gezeigt).
- Gemini übersieht helle Objekte gelegentlich (Lampenschirm über einer Rahmenecke); die Pixel-Gegenprobe fängt nur klar farbige oder dunkle Objekte.
- Die Hand-Szene konnte nicht noch einmal Ende-zu-Ende laufen: Google war ab 13:02 pausiert (von Hand). Ihre Pixel-Ergebnisse oben stammen aus dem gleichen Code mit gespeicherten Gemini-Boxen.
