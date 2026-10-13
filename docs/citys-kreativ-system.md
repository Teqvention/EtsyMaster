# Citys: das Kreativ-System (Levels, Sky, Stil-Treue, Sets, Produce)

**Stand:** 13.10.2026. Wie ein Citys-Bild entsteht und warum (dazu: Kompositionen 1:1 nachbauen, Abschnitt 15;
Unterorte und Ranking, Abschnitt 16). Code: `src/lib/citys/prompts.ts` (alle Texte für
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

## 6 · Echte Kompositionen statt erfundener (13.10.)

**Feedback 13.10.:** Die Foto-Sets sahen generisch aus. Honolulu hatte zweimal dieselbe Komposition, Diamond Head
stand hinter allen drei Bildern. Amalfi zeigte Steinstrand, Steinmole und Viadukt-Bögen, also laut statt ruhig. Die
Häuser wirkten leicht KI-generisch. **Ursache:** Der Art Director hat jede Komposition selbst erfunden. Die alten
Regeln („rahmender Vordergrund: Felsen“, „führende Linie: Steg“) haben ihn zu harten Stein-Vordergründen verleitet.
Das Geografie-Foto bekam der Maler nur „für die Geografie“, die Häuser hat Nano Banana dazu erfunden.

**Jetzt: Re-take.** Neue echte Fotos fotografieren echte, verkaufte Kompositionen neu. Das gilt für New ideas, Sets
und Foto-Stile mit „nach Bestsellern Mid/High“:
- Der Art Director sieht 8–12 Fotos aus den Bestseller-Postern der **Top-Shops des Ortes**, nummeriert. Von jedem
  Shop kommt zuerst das beste Foto, dann der Rest. Die Referenz selbst ist nie dabei.
- Jedes Bild nimmt eines davon (`photo`), nie eines doppelt. Nimmt er eins doppelt oder keins, wird einmal
  nachgefragt.
- **Die Nummer steht im Foto.** Der Art Director sieht sie groß oben links (`numbered` in `generate.ts`), der Maler
  bekommt das Foto ohne. Nach Position gezählt und auch mit „Photo N“ zwischen den Bildern hat er jedes Mal das Foto
  nach dem gemeinten genannt, weil er eine Beschriftung dem Bild davor zuordnet. Das zeigte der Test am 13.10.
- Fotos, die frühere Sets **dieser Referenz** schon genommen haben, kommen erst wieder dran, wenn zu wenige übrig sind.
  Früher erfundene Ansichten sperren die klassischen Motive nicht mehr.
- Der Maler bekommt das Foto **als Szene**, die er noch einmal fotografiert. Jedes Haus, die Küste, die Berge und die
  Wahrzeichen bleiben wie im echten Foto. Es soll aber **unser eigenes Foto** werden, nie dasselbe noch einmal: Die
  Kamera steht ein paar Schritte weiter (etwas höher, tiefer oder seitlich, etwas weiter oder enger), dazu ein anderer
  Moment (Sky, Licht), andere oder keine Boote und Menschen, kein Kram, Hochformat. Im ersten Test kam ein Positano
  sonst mit demselben roten Boot an derselben Stelle. Den Look übernimmt er nur von der Referenz, nie Farben oder
  Grading des Fotos, auch nicht bei Schwarzweiß.
- **Prüfung der Antwort** (`retakeProblems`): Der Planer nennt zu jedem gewählten Foto die sichtbaren Wahrzeichen
  (`landmarks`). Steht eines in zwei der ersten drei Bilder (Paris: zweimal Eiffelturm) oder ist ein Foto doppelt,
  wird einmal nachgefragt. Für Sets sieht er 10–16 Fotos statt 8, damit auch bei Paris mehr als der Eiffelturm
  dabei ist. Zeigt wirklich keines ein anderes nötiges Motiv, setzt er `photo` = 0 und komponiert dieses eine Bild aus
  dem Orts-Briefing.
- **Die Referenz nur für den Look:** Der Maler erfährt, welche Wahrzeichen die Referenz zeigt (`read.landmarks`), und
  dass sie nicht ins Bild dürfen, außer die Szene zeigt sie. Eine Diamond-Head-Referenz hatte sonst Mokoliʻi durch
  Diamond Head ersetzt. Und „behalte ihre Komposition“ steht nicht mehr im Prompt: Damit kam Ravello Pixel für Pixel
  wie im Konkurrenzfoto zurück. Jetzt heißt es „alles darin bleibt echt, der Bildausschnitt nicht“.
- **Set-Regel** (`retakeSetRule`):
  - Die berühmteste Ansicht ist immer dabei.
  - Jedes Bild hat ein eigenes Motiv **und einen eigenen Hintergrund**, Diamond Head steht also nur in einem Bild.
  - Wo es Natur gibt, ist **ein reines Naturbild ohne Häuser** dabei: die Insel allein im Meer, die Bucht oder der
    Strand von oben, Palmen über türkisem Wasser, ein Dünenweg.
  - Die Bilder haben verschiedene Abstände und Standpunkte, also nie dreimal vom Balkon.

**Ruhig an Natur- und Strandorten** (`calmText`, für die Settings beach, island, nature, lake und mountains sowie
Küsten wie die Amalfiküste). Gelernt bei Traposto (Dünenwege, Holzstege, leere Strände von oben), bei Postour (die
Insel allein im Pastellmeer) und an Amalfis Top-Shops (die Orte vom Weg oder einer Terrasse darüber):
- Stille, ehrliche Blicke, ruhiges klares Wasser, viel Luft. Ein Ort ist Teil der Landschaft, aus der Ferne oder von
  oben gesehen, nie eine Häuserwand über das ganze Bild.
- Nie laut oder schwer: kein Kies- oder Steinstrand im Vordergrund, keine dunklen Mauern, Molen, Bögen oder Viadukte,
  keine Brandung quer durchs Bild, keine Bootsbuge, keine dramatischen Untersichten.

**Fotografische Grundregeln** (`PHOTO_COMPOSITION`, neu gefasst): ein echter Standpunkt, wie ihn die Bestseller zeigen;
ein klares Motiv vom klassischen Standpunkt; einfach, wenig Elemente, viel Himmel; Vordergrund höchstens leicht am Rand
(Zweig, Bougainvillea, Palmwedel, Dünengras, Geländer); am Wasser immer ruhig; nie Massentourismus.

**Echte Häuser** (`REAL_RULES`): Jedes Gebäude hat seine eigene Form, Farbe, Fenster und Dach wie in den Fotos des
Ortes. Nie generische Füllhäuser oder einen Hang aus fast gleichen Kisten. Dazu echte Optik: Details werden mit der
Entfernung und im Dunst weicher, nichts ist überall gleich scharf.

**Ortswissen aus den Bestsellern:** Das Orts-Briefing (Version 2) wird weiter aus den Bildern der meistverkauften
Poster geschrieben. Für Kunst-Stile sieht der Art Director die Fotos weiterhin nur zur Geografie, der Maler bekommt
keine.

## 7 · Stil-Treue mit „Manner“

Beim Einlesen schreibt Gemini zusätzlich einen kurzen **Manner**-Absatz (40–80 Wörter, wie man einem begabten
Illustrator den Stil in einem Atemzug beschreibt: Gefühl, Medium, Strich, Farben, wie viel Papier frei bleibt). Jedes
Kunst-Bild beginnt damit, danach die Szene als kurze, konkrete Beschreibung, dann nur vier Zeilen Stil-Notizen statt
der langen Regel-Liste. **Schilder und kleine Objekte sind optional** — der Stil lebt in Linie, Farbe, Papier und wie
Gebäude, Bäume und Menschen gezeichnet sind.

## 8 · New ideas für Stile

Auf der Stil-Seite: **New ideas** → Anzahl Richtungen (1–6), Städte (bis 6, je „1 poster“ oder „Set of 3“), optional
der Stil selbst zum Vergleich. Gemini schlägt **nahe Geschwister** des Stils vor (gleiche Material-Familie, immer hell,
nie dunkel/monochrom/Neon, je ein bis zwei Aspekte verändert: Palette, Wash, Strich, Papier, Himmel, Figuren,
Detail), schreibt für jede den Guide um und malt sie auf die Städte. Jede Richtung zeigt **„Holds together by“** — was
die Serie zusammenhält. Pro Richtung: **Make main** (wird der Stil), **Own style** (eigener neuer Stil), **Drop**.

## 9 · Neuer Stil aus Outputs

In Outputs: **Select for a style** → Poster anklicken → **New style from N** → Name. Die Bilder werden das Board des
neuen Stils (bis 20), er wird eingelesen und öffnet im Lab.

## 10 · Stil-Treue: Umzeichnen statt neu malen (13.10.)

**Befund:** Bei Kunst-Stilen malte Nano Banana den Stil „aufgeräumt“: feinere Linien, mehr Architektur-Detail,
blassere Farben als das Board. Ein kürzerer Prompt (1.349 statt 5.127 Zeichen) änderte daran fast nichts. Ein echtes
Geografie-Foto und die lange Wahrzeichen-Liste zogen Kunst zusätzlich in Richtung Detail und sind für Kunst entfernt.
**Durchbruch im direkten Vergleich:** Nano Banana ist ein Bearbeitungs-Modell. Wenn es ein **Board-Poster als neuen
Ort umzeichnet**, bleiben Strich, Farbe und naive Figuren deutlich näher am Original.

- **Malstrategie pro Stil** („How it's painted“ im Lab): **Redraw a board poster** (Standard) — der Art Director wählt
  für jedes Motiv das Board-Poster mit der passendsten Komposition, das umgezeichnet wird; **Next in the series** — das
  nächste Poster der Serie aus ein paar Board-Postern (freiere Komposition).
- **Kunst-Prompts sind kurz** („lean“): Serie, Szene, Manner, ein Satz zur Treue, Format. Fotos behalten die
  vollständigen Regeln.

## 11 · Testen und Verbessern im Lab

- **Testgrößen:** Small · 2 und Middle · 3 Orte aus Worten (Rom, Amalfiküste, Amsterdam, …), Full wie bisher.
- **Autonomous testing:** malt den Stil, ein strenger Kritiker vergleicht mit dem Board (Stil zählt doppelt,
  Komposition, Ort, je 0–10, mit „Still misses“), schreibt den Guide um bzw. probiert die andere Malstrategie, malt und
  bewertet erneut, behält das Beste (1–4 Durchgänge). Schlägt eine Version den Start um ≥ 0,3, wird sie neue Version
  samt Malstrategie (die alte bleibt in der History). Läuft im Sync.
- **Interview:** malt vorher einen frischen Testlauf (Middle) der aktuellen Version, falls es keinen gibt, und fragt
  dann. Die fünf Vorschläge sind drei gezielte Fixes und zwei interessante Änderungen.
- **Try a version:** Vorschläge in Versionen sammeln — alle Häkchen einer Version ergeben **eine** Variante mit diesen
  Änderungen zusammen; **„+“** öffnet Version 2 usw. Jede Version wird als Middle-Runde gemalt.

## 12 · Eigene Skies

Unter Citys → Styles → Skies: **New sky from photos** (1–5 Fotos, optional ein Name). Gemini liest nur Himmel und Licht
(nie den Ort) und schreibt ihn wie die eingebauten Skies, in der hellen Hausregel (dunkle Fotos werden als hellste
Version beschrieben). Eigene Skies erscheinen im Sky-Picker unter „Your skies“; beim Malen bekommt Nano Banana das Foto
als Himmels-Vorlage mit.

## 13 · Was sich verkauft (Top 100 aller erfassten Shops, 13.10.)

- **Ein Drittel der Top 100** sind Detaillerias Aquarell-Stadtposter, viele als **Set of 3** (Boston-Set 19,8/Monat,
  NYC-Sets 11,3 und 8,3). Platz 1 (34,5/Monat): PrintsHeavenlyCos rosa NYC-Sketch.
- **Die Bildformel der Zeichnungen:** Straße oder Promenade zum Wahrzeichen am Fluchtpunkt, Bäume und Laternen rahmen,
  Blumentöpfe oder Bank in den unteren Ecken, ein paar Spaziergänger, Radler, Oldtimer, viel heller Himmel.
  Sets: drei verschiedene Szenen derselben Stadt in derselben Formel.
- **Echte Fotos:** klassischer Standpunkt, ein klares Motiv, rahmender Vordergrund, führende Linie, viel Himmel, ruhig
  und ohne Massentourismus (Traposto, Postour, Advntre).

## 14 · Tests (alle „Now“, Nano Banana 2.1)

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

**Welle 5–7 (13.10.):**
- **Pink-Sketch-Test des Nutzers (16 Bilder):** Stil verfehlt — zu sauber, zu detailreich, blasser; der Block „From
  photos“ malte dichte Stadtpanoramen. Ursache gefunden (langer Prompt, Geografie-Foto, Wahrzeichen-Liste, und vor
  allem: Nano Banana „räumt auf“). Lösung: Umzeichnen-Strategie (s. 10), kurze Kunst-Prompts, kein Foto für Kunst.
- **Direkter Vergleich (Rom, Pink sketch):** alter langer Prompt ≈ Lean ≈ Serie mit 2 Bildern; **Umzeichnen nach dem
  passenden Board-Poster** klar am nächsten (dunklerer, wackeliger Strich, fette Schilder, naivere Figuren).
- **Aquarell-Stil „Watercolor city sketch“ (Detailleria-Board), 5 unbekannte Städte × Set of 3:** Stil sehr gut
  getroffen; Schwächen in der Set-Planung (dreimal Eiffelturm, dreimal Gracht, Opernhaus fehlte, voller Bondi-Strand)
  → Set-Regeln (Ikone immer dabei, ein Wahrzeichen führt nur ein Bild, drei Szenenarten), „schon gemacht“ nur noch im
  selben Stil, fast leere Strände.
- **Retest mit Umzeichnen, 4 Städte × 3 (London, Rom, Barcelona, Amsterdam):** alle 12 sehr nah an Detailleria und
  abwechslungsreich (Sagrada-Allee, Park-Güell-Bank, Promenade; Magere Brug, Grachtenbrücke, Rijksmuseum mit Tulpen).
- **Umzeichnen bei sehr kleinem Board (4 Bilder):** kopiert das Board-Poster zu wörtlich (Rom mit „SENS UNIQUE“)
  → Prompt verlangt jetzt neue Schilder in der Landessprache und ersetzt jedes Gebäude; Autonomous testing wählt pro
  Stil zwischen „redraw“ und „series“.
- **Eigener Sky „Hawaii blush“** aus einem Honolulu-Foto, auf die NYC-Straße angewandt: genau dieses Blush, echt.
- **Foto-Sets Amalfi:** zwei von drei Bildern zeigten wieder Atrani aus der Referenz → bei New ideas und Sets kommt
  jetzt zuerst das Foto des Motivs, die Referenz danach nur für den Look.
- **Autonomous testing, Pink sketch (Small, 2 Durchgänge, 10 Bilder):** Start mit redraw 6,5 (Stil 6, Komposition 7,
  Ort 7); „series“ 6,8 (Stil 5, Ort 9); **redraw + Fixes des Kritikers 7,8 (Stil 7, Komposition 8, Ort 9) → als Version
  3 übernommen.** Weitere Umschreibungen 7,3. Der Kritiker nennt bei gemischten Boards widersprüchliche Sättigungs-Hinweise
  (das Board selbst ist teils blass, teils kräftig) — die Gesamtnote trennt trotzdem sauber.
- **Foto-Sets nach der Korrektur (Amalfi, Honolulu, je 3):** kein Bild kopiert mehr die Referenz (Positano vom Strand,
  Amalfi mit Holzboot, Atrani durch den Viadukt-Bogen; Waikiki mit Diamond Head, Royal Hawaiian, Palmen über türkisem
  Wasser), alle echt, ohne Massen, mit dem Look der Referenz.

- **Re-take, 13.10. (Feedback zu Honolulu und Amalfi):**
  - Erster Lauf: Bei Amalfi passten die gewählten Vorlagen. Bei Honolulu beschrieb der Planer jeweils das Foto
    *vor* der genannten Nummer, nach Position gezählt und auch mit „Photo N“ als Text zwischen den Bildern. Mit der
    Nummer groß im Foto stimmte jede Zuordnung.
  - Neue Referenzen (Diamond Head von Postour, Amalfi von Postour): Positano mit neuem Boot und mehr Abstand, die
    Skyline vom Diamond Head aus sowie Mokoliʻi mit Palmen waren echt und neu fotografiert. Ravello, die Statue und
    die Faraglioni kamen zunächst fast deckungsgleich mit der Vorlage zurück. Mit „Bildausschnitt nicht übernehmen“
    und einem konkreten Kamerastandpunkt vom Planer kamen sie mit neuem Ausschnitt.
  - Kompletter Durchlauf mit der Atrani-Referenz: Positano vom Klippenweg (ruhig, Strand ohne Schirme), die Klippen
    als reines Naturbild und Atrani vom Wasser aus, alle echt. Paris: Eiffelturm vom Trocadéro mit Wasserbecken,
    Louvre-Pyramide mit Spiegelung und Pont d'Iéna, alle mit echter Architektur und eigenem Ausschnitt. Der Eiffelturm
    kam dabei zweimal vor, daher die neue Wahrzeichen-Prüfung. Danach plante Paris Eiffelturm, Louvre und ein
    Dächer-Panorama.

**Gesamt seit 12.10.: über 180 Sync-Bilder, 0 Malfehler** (Ausfälle nur durch den Netzwerkausfall am 13.10.).

## 15 · Kompositionen 1:1 nachbauen (13.10.)

Ziel: Eine Poster-Komposition (PNG des Designs oder Mockup-Foto mit dem Poster) wird so nachgebaut, dass sie im eigenen
Wortlaut Pixel für Pixel auf dem Original liegt; danach wird sie zur Vorlage für jeden Ort. Code:
`src/lib/citys/composition/` — `sheet.ts` (Poster aus dem Foto, Licht), `measure.ts` (Messen), `fit.ts`
(Schrift einpassen), `fontmatch.ts` (Schrift finden), `rebuild.ts` (Ablauf, Vergleich, Vorlage), `render.ts` (Satz).

**Ablauf (Composition → „From an image“):**
1. **Poster aus dem Foto:** Gemini nennt grob die vier Ecken, die Pixel finden die Papierkanten, entzerrt auf ein
   Druckformat, Rahmenreste weg. Danach **gleichmäßiges Licht** (`evenLight`): Papierhelligkeit Zelle für Zelle aus dem
   Papier selbst, das Foto ausgespart, jede Stelle auf Papierweiß gehoben (Glas-Reflexe, Rahmenschatten: 190–226 → eben).
2. **Messen** (1000 breit, 1 Pixel = 1 Einheit): Papierfarbe, Fotorahmen (auch mit dunstigem, fast weißem Himmel:
   Bänder über einer Dunstzone gehören zum Foto, wenn ihre Kanten die des Fotos sind), jede Zeile, jeder Absatz mit
   Spalten, Linien, Farbfelder (Farbleisten werden in einzelne Felder geteilt), Symbole. Für Fließtext je Zeile das
   **x-Höhen-Band auf 0,1 px** (Grauwert-Profil, Halbwertskanten) — aneinanderstoßende Zeilen verlieren sonst Ober-
   und Unterlängen (12 statt 16 px → Schrift 25 % zu klein). Zusammengewachsene Doppelzeilen werden an der dünnsten
   Stelle getrennt.
3. **Gemini liest die Marken** (mit nummeriertem Overlay): Rolle (city, country, code, story …), Wortlaut, Schriftart,
   und für Absätze **jede gedruckte Zeile** (mit Trennstrichen) sowie fett gesetzte Wörter als `**…**`.
4. **Schrift finden:** jede Kandidatin (Geminis Tipp + Google Fonts derselben Art) wird gesetzt und mit den Pixeln
   verglichen — Titel nach Tintenhöhe, Fließtext nach x-Höhe und Grundlinie, Blocksatz-Zeilen über die Wortabstände.
   Die Weichheit eines Fotos wird einmal geeicht (sonst gewinnt immer die fettere Schrift); das Gewicht bleibt bei
   Fließtext höchstens einen Schritt von Geminis Einschätzung. Jede gedruckte Zeile muss in der Schrift in die Spalte
   passen; wo das Original eng gesetzt ist, bekommt der Absatz genau die nötige negative Laufweite.
5. **Satz und Vergleich in Schleife:** gezeichnet im Wortlaut des Originals (mit dessen Zeilenumbrüchen, die Zeilen
   bleiben im Blocksatz; mit dessen Foto), verglichen (Hälfte Tinte deckungsgleich auf 1 px, Hälfte Pixel gleich, Foto
   ausgenommen). Jede Korrektur (Lage, Größe, Laufweite) wird einzeln probiert und nur behalten, wenn das ganze Poster
   näher kommt; einmal schaut Gemini auf die Schrift. Ergebnis: Score, Bilder (Original, Nachbau, Differenz).
6. **Vorlage:** Wörter werden Platzhalter; ein fetter Ortsname vorne im Text bleibt als `**{city}** {story}`
   (die Geschichte wiederholt den Namen dann nicht).

**Im Editor:** Score-Leiste über der Fläche („72,5 % alike“), Original darüberlegen (**Slider** zum Ziehen oder
**Difference**: schwarz = deckungsgleich, hell = Abweichung; bearbeiten geht dabei weiter), „Check“ (nur neu
vergleichen, nach Handkorrekturen), „Improve“ (3 Durchgänge), Dialog mit den Vergleichsbildern und allen Durchgängen.
**„Good example“** markiert eine Komposition als Bestseller-Beispiel: Remix und Combine sehen bis zu drei Beispiele
(als Originalposter) und die Shop-Regeln (gleiche Abstände Foto–Text–Unterkante, Textblock im Blocksatz voll
ausgefüllt, Ortsname führt, Kopfzeile Kürzel links / EST. oder Land rechts, clean, keine schweren Schwarzflächen).
Neu im Renderer: Silbentrennung im Blocksatz, `**fett**` im Text, Zeilenumbruch mit Blocksatz für Nachbauten; der
Editor lädt bei fehlendem Schriftschnitt den nächsten (wie der Druck) statt eines grauen Kastens.

**Tests (13.10., Google pausiert → Etiketten von Hand, Rest echt):**

| Poster | vorher | jetzt | Rest |
|---|---|---|---|
| NYC Mockup (Farbe, 3 Spalten) | 72,5 | **94,4** | Fließtext-Schrift (Alegreya 500 −5 statt Garamond-artig) |
| NYC Schwarzweiß (CitysInBlack-Stil) | – | **92,0** | Fließtext-Schrift; fetter Lead jetzt drin |
| Japan (Traposto) | – | **82,0** | Fließtext sehr schmal gesetzt (≈ 22 % enger als normal; vermutlich gestaucht) |

Offen: Ein echter Durchlauf aller sieben Beispiele aus den Downloads mit Gemini-Etiketten, sobald Google wieder
läuft; horizontale Stauchung (scaleX) als eigene Eigenschaft, falls weitere Shops gestauchten Text nutzen.

## 16 · Unterorte und Ranking (13.10.)

Verglichen mit den Ranking-Systemen der drei anderen Worktrees (variante-a/b/c). Ergebnis: Im Register fehlt kein
relevanter Ort; die Lücke war die Faltung.

- **Faltung nur in Siedlungen** (`src/lib/citys/folding.ts`): Ein District, Landmark, Strand oder Stadtpark zählt nur
  bei einer Stadt, einem Ort oder einem Stadtteil mit. In einer Region, einem Park, auf einer Insel oder Küste ist er ein
  eigener Ort (vorher stand County Clare auf A wegen der Cliffs of Moher, Page wegen des Antelope Canyon, Wiltshire wegen
  Stonehenge). Jetzt: Cliffs of Moher B #108 als eigener Ort, Milford Sound und Mont-Saint-Michel ebenso.
- **Unterorte mit eigenem Poster:** Jeder Unterort wird auch nach seinem **eigenen Namen** gemessen (Listings, deren
  Titel ihn vor der Stadt nennt: „Central Park Print, New York“). Mit eigenem Tier A–C auf der Skala der Orte, in
  3 Shops (oder im oberen Viertel von 2) und ≥ 0,5 Verkäufen oder ≥ 5 Favoriten im Monat bekommt er **eine eigene Zeile
  direkt unter seiner Stadt** („Own poster“; „Test poster first“, wenn > 60 % davon ein Listing ist; „most of its
  sales“, wenn er die halbe Nachfrage der Stadt trägt). Er bleibt bei der Stadt mitgezählt. Im Stealer und Ranking
  eingerückt, mit eigenen Referenzen (seine eigenen Listings), eigenen Fakten (`{city}` = Unterort, `{region}` = Stadt),
  eigener Abdeckung (unsere Listings, die mit seinem Namen beginnen).
  Im aktuellen Scope („Real“, 8 Shops) z. B.: Central Park A, Brooklyn A, Bondi Beach A, La Jolla A, Golden Gate
  Bridge B, Brooklyn Bridge B, Queens B, Shibuya Crossing B, Waikiki Beach C, Antelope Canyon C (trägt Page), Taj
  Mahal C (Test). Über alle 22 Shops sind es laut Analyse ≈ 70 städtische Unterorte (Waikiki dort 8,9 Verk./Monat).
- **Ranking:** Lift jetzt gegen den Schnitt des eigenen Shops (große Kataloge drücken ihre Orte nicht mehr, ein
  Hit-Shop hebt sie nicht); ein Ort aus einem einzigen jungen Listing ist höchstens C. Spitze unverändert, Bewegung
  nur im langen Schwanz.
- **Register korrigiert** (Backup vorher: `~/Etsy Master/.cache/backup-citys-places-*.json`): San Diego Stadt statt
  Region, Hawaii Bundesstaat, County Clare Region; zusammengelegt: Mount Rainier/Grand Teton/Denali → ihr Nationalpark,
  Kilimanjaro NP → Mount Kilimanjaro, Connemara NP → Connemara, Amalfi Coast FR → IT, Venice AT → IT, Hong Kong CN → HK,
  Puerto Rico (Insel) → Land, San Juan US → PR, Niagara Falls US → CA, Patagonia CL → AR, Rocky Mountains CA → US,
  Lake Superior CA → US. Nicht angefasst: Paris CA (eine Produktion verweist darauf).
- **Nicht übernommen:** B's Hierarchie mit Roll-up in alle Vorfahren (Städte unter Bundesstaaten), reine Perzentile,
  C's feste Rang-Tiers. **Später sinnvoll:** geprüfte Ortsfakten aus dem alten Projekt (`~/claude/Etsy/daten/orte.json`)
  als Vorbelegung, Titel-Zuordnung ohne Gemini für bekannte Namen, Etsy-Suchvolumen als Zusatzsignal.
- Hinweis: Das Ranking steht seit 13.10. 06:47 auf Scope „Real“ (8 von 22 Shops) — für „welche Orte fehlen“ alle
  Shops wählen.

## 17 · Set of 3: das Wahrzeichen in einem Bild, Textur (13.10.)

- **Ein Wahrzeichen steht in genau einem Bild eines Sets** — auch nicht im Hintergrund, am Horizont oder hinter einer
  Brücke. Ein Paris-Set hatte den Eiffelturm vom Trocadéro und noch einmal hinter dem Pont d'Iéna, ein Style-Set in
  allen drei Bildern. Robin: lieber Montmartre, Arc de Triomphe oder ein süßes Café. Geprüft für jedes Set (Fotos und
  Styles) über die `landmarks` jedes Bildes und den Namen in den anderen Briefs (`setRepeats` in prompts.ts); bei einer
  Wiederholung wird einmal neu geplant.
- **Textur:** gemalte Poster bekommen die Textur ihres Originals (Korn, bei Kunst leicht fleckige Farbe, weichere
  Kanten), siehe `docs/styles-autonom.md` Abschnitt 8.
