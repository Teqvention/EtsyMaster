# Styles: Autonomous scale und Stil-Treue bei Variants und New ideas

**Stand:** 13.10.2026. Wie aus einem Style beliebig viele neue, einzigartige Poster werden, die genau seinen Look und
sein Gefühl treffen, und wie Variants und New ideas näher am echten Stil bleiben. Code: `src/lib/styles/study.ts`
(die Studie des Boards), `src/lib/styles/auto.ts` (Planer, Maler-Prompt, Style-Set), `src/lib/styles/auto-check.ts`
(Prüfung und Neumalen), `src/lib/generation/prompts.ts` (Variants und New ideas). Oberfläche: Style-Seite →
„Autonomous scale“; im Style-Set → „Scale more“.

## 1 · Das Wichtigste

1. **Look und Gefühl bewegen sich nie, nur das Bild.** Die Kreativitätsstufe sagt, wie weit sich Motiv, Szene,
   Perspektive und Komposition vom Board entfernen, nie Malweise, Palette, Licht oder Emotion. Auch Stufe 5 ist kein
   neuer Stil, sondern die mutigste neue Idee im selben Stil.
2. **Das ganze Board wird verstanden, nicht nur die Style-Beschreibung.** Beim Klick auf „Autonomous scale“ liest
   Gemini jedes Bild einzeln (Motiv, Komposition, Emotion, Malweise, Stärke als Poster) und danach das Board als
   Serie (Welt, Gefühl, Familien gleicher Hand, Regeln). Die Studie bleibt am Style gespeichert und wird nur neu
   gelesen, wenn sich das Board ändert.
3. **Jedes neue Poster hat einen Anker:** das Board-Bild, dessen Hand es übernimmt, plus ein bis zwei Bilder derselben
   Familie. Nano Banana bekommt diese Bilder, nicht eine Beschreibung des Stils.
4. **Der Planer beschreibt nur den Inhalt.** Kein Wort über Palette, Textur oder Pinselstrich (Nano Banana übertreibt
   solche Worte: „heavy impasto“ wird zu Wülsten, „detailed fur“ zu feinem Fell). Den Look nimmt der Maler aus dem Anker.
5. **Jedes Poster wird geprüft.** Gemini vergleicht es mit seinem Anker (gleiche Hand? gleiches Gefühl? starkes
   Poster?). Schwache werden einmal neu gemalt, klare Fehlgriffe zusätzlich abgelehnt (siehe 5).
6. **Styles fassen beliebig viele Bilder** (`MAX_IMAGES` = 1000). Die Style-Beschreibung liest weiter eine Auswahl,
   die Studie für Autonomous scale jedes Bild.

## 2 · Die fünf Stufen bei Autonomous scale

| Stufe | Was sich bewegt |
| --- | --- |
| Minimal | Geschwister eines Board-Bildes: gleiche Art Motiv, Pose, Szene, Komposition und Farben, zwei, drei kleine sichtbare Änderungen (Requisite, Essen/Getränk, Muster, Hintergrunddetail, Tierart oder Zeichnung). Ausdruck, Pose, Energie, Licht und Palette bleiben. |
| Subtle | Die Szene des Ankers mit einer echten Änderung: anderes Tier ODER andere Requisite/Tätigkeit ODER ähnlicher anderer Ort, so komponiert wie der Anker. |
| Low | Remix in der Serie: die Szene des Ankers mit einem Element eines anderen Board-Bildes (Figur, Ort, Tätigkeit), neu arrangiert. |
| Medium | Eine neue Szene aus der Welt der Serie, die es auf dem Board nicht gibt — nie der Ort oder die Komposition des Ankers mit einem anderen Tier. |
| High | Die mutigste nächste Idee des Künstlers: überraschende Situation oder Perspektive (von oben, ganz nah, weit, durch eine Tür, Spiegelung), keinem Board-Bild ähnlich. Neue Idee und Komposition, nie ein neuer Look oder ein neues Gefühl. |

Die Anzahl wird gleichmäßig über die gewählten Stufen verteilt (15 über alle fünf = 3 je Stufe). Eine Anfrage hat
höchstens 200 Poster (`MAX_AUTO`); jede weitere Anfrage kommt ins selbe Set und kennt alles, was schon gemacht ist
(„Already made“), damit nichts doppelt entsteht. Anker werden über das Board verteilt, starke Bilder (Stärke 4–5)
zuerst.

## 3 · Ablauf

1. **Style-Set:** Pro Style gibt es ein Generierungs-Set (Ordner „Styles“, Titel „<Style> · Autonomous scale“). Seine
   Poster sind Kopien der Board-Bilder (neue Board-Bilder kommen bei der nächsten Anfrage dazu), also funktionieren
   Review, Approve/Reject, Download, „More like this“ und Compare wie überall. Im Viewer ist „Reference“ der Anker.
2. **Studie** (`study.ts`): Bild-Karten in Paketen zu 6 Bildern parallel (24 auf einmal brauchten über 3 Minuten und
   liefen in Googles Zeitlimit), dann ein Blick aufs ganze Board mit den Karten: Essenz, Emotion (auch was sie nie
   ist), Welt (Figuren, Orte, Requisiten, Tätigkeiten), wiederkehrende Kompositionen, Familien, Keep/Avoid. Jedes Bild
   trägt seine Nummer eingezeichnet (Gemini verzählt sich sonst). Dauer bei 24 Bildern: etwa 1,5 Minuten.
3. **Planer** (`planAuto`): je 8 Poster pro Gemini-Antwort; jedes Paket geht sofort zum Malen, während das nächste
   geplant wird. Pro Poster: Stufe, Anker, Refs, Titel, Brief (Motiv und was es tut, Ausdruck und Körpersprache,
   Ort und Requisiten, Komposition, Schrift oder „no lettering“).
4. **Maler** (`autoPrompt`): Anker zuerst, dann die Refs. „Paint it exactly like image 1 — look at it, don't
   interpret it“, dann die Regeln gegen das Verfeinern (keine feineren Linien, kein zusätzliches Detail in Fell,
   Gesichtern, Mustern, Hintergründen, keine glattere Übergänge, kein knackigeres Impasto, keine grelleren oder
   dumpferen Farben), das Gefühl der Serie, Keep/Avoid aus der Studie. Format wie der Anker.
5. **Prüfung** (`auto-check.ts`): siehe 5.

## 4 · Variants und New ideas (ohne Style)

Robins Beispiele vom 13.10.: Bei Idea wurde aus einem fröhlichen Tiger in einer sonnigen Bar ein Löwe in einer dunklen,
detailreichen Bibliothek („Lion's Quiet Reading Room“). Bei Minimal wurde aus einer seligen Katze mit geschlossenen
Augen eine grimmige Katze mit schwerem Impasto. Die Ursache stand in den Prompts: Minimal durfte „pose or expression“
ändern, und jeder Brief beschrieb Palette, Textur und Licht neu, was Nano Banana übertreibt. Jetzt:

- **Minimal** ändert nur kleine Dinge (Form oder Ort eines kleinen Objekts, Muster, Hintergrunddetail, Ausschnitt).
  Figuren behalten Ausdruck, Blick, Pose und Energie.
- **Gefühl bei jeder Stufe** (`KEEP_FEELING`): Ausdruck, Körpersprache, Energie, Wärme des Lichts, Humor der Referenz.
  Nie ruhiger, trauriger, dunkler, düsterer, dramatischer oder ernster. Dazu dieselbe Einfachheit: etwa so viele
  Elemente wie die Referenz, Neues so vereinfacht wie dort („a library is a few shelves of colour blocks“).
- **Medium/High** dürfen Idee, Szene, Perspektive und Komposition frei bewegen, nie Look oder Stimmung.
- **Briefs beschreiben den Look nicht mehr** („in the reference's exact look“; Farben nur für neue Objekte, aus der
  Palette der Referenz).
- **Maler** (`SAME_HAND`): gleiche Pinselführung, kein schwereres Impasto, keine glattere Oberfläche, nicht
  verfeinern, gleiche Palette und Licht, gleiches Gefühl.
- Die Poster-Analyse beschreibt die Stimmung jetzt genauer (Ausdruck, Körpersprache, Energie, Licht, Humor) und die
  Malweise mit „wie locker, wie dick, wie viel Detail“.

## 5 · Die Prüfung

Nach dem Malen vergleicht Gemini das Poster mit Anker und Refs: erst Punkt für Punkt die Unterschiede (Strichgröße,
Textur, Kanten, Detailmenge, Flachheit, Palette, Licht), dann Noten 1–10 für Stil, Gefühl und Poster, dazu Notizen
für ein Neumalen. Bild-Modelle scheitern fast immer gleich: zu fein, zu detailliert, zu glatt, zu sauber, zu grell.
Genau danach wird gesucht. Die Noten stehen am Output (`check`).

- **Kalibrierung** (an den Testläufen gegen mein eigenes Urteil): 9–10 = hängt mit der Serie; 6–7 = etwas straffer
  gemalt als der Anker, oft trotzdem gut; ≤ 5 = klarer Fehlgriff (andere Hand, Kopie des Board-Motivs, zu grafisch).
- **Klarer Fehlgriff** (`MISS`: Stil oder Gefühl ≤ 5, Poster ≤ 4): das Bild wird automatisch abgelehnt (Notiz
  „Auto check: …“, unter Rejected weiter sichtbar) und einmal neu versucht. Bei falscher Hand wird der erste Versuch
  **übermalt** (`repaintPrompt`: Bild 1 = unser Entwurf, Bild 2 = Anker; das Bild bleibt, die Malweise wird die des
  Ankers). Bei falschem Gefühl oder schwachem Poster wird neu gemalt, mit den Notizen.
- **Alles andere bleibt**, auch eine 6: Neu von vorn malen brachte bei 6ern dieselbe 6 (dieselbe Verfeinerung), das
  kostet nur Bilder.
- Ein zweiter Versuch wird nie noch einmal neu gemalt.

## 6 · Tests (13.10., dopamin, 24 Board-Bilder)

Siehe Abschnitt 7 für die Ergebnisse der Läufe.
