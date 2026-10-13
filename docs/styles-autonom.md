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
   Poster?) und schreibt die Noten ans Bild. Abgelehnt oder neu gemalt wird automatisch nichts (warum: siehe 5).
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
4. **Maler** (`autoPrompt`): Anker zuerst, dann die Refs (bei Minimal und Subtle nur der Anker: eine Familie kann
   mehr als eine Hand enthalten, und ein Ref zog ein dunkles Geschwister-Bild ins Knallbunte). „Paint it exactly like image 1 — look at it, don't
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

Nach dem Malen vergleicht Gemini jedes Poster mit Anker und Refs: erst Punkt für Punkt die Unterschiede
(Strichgröße, Textur, Kanten, Detailmenge, Flachheit, Palette, Licht), dann Noten 1–10 für Stil, Gefühl und Poster,
dazu Notizen. Die Noten stehen am Output (`check`) und im Viewer unter „Art direction“ („Auto check · style 9 ·
feeling 10 · poster 10“).

**Automatisch abgelehnt oder neu gemalt wird nichts** (`RETAKE = false`). Getestet und verworfen:

- Gemini urteilt gegen einen Anker zu streng, wenn das Board gemischt ist. Bei dopamin fielen Bilder durch, die gut in
  die Serie passen (Katze im Strandstuhl, Discokugel-Katze, gestapelte Köpfe hinter dem Vorhang: alle Stil 5).
- Neu von vorn malen mit den Notizen änderte die Hand nicht (5 → 5, 6 → 6).
- Den ersten Versuch in der Hand des Ankers übermalen (`repaintPrompt`) gab fast dasselbe Bild zurück (5 → 6).

Nano Banana malt Tiere und Szenen ordentlicher als ein lockeres Board; das lässt sich im ersten Versuch über die
Regeln dämpfen (siehe 3), ein zweiter Versuch holt es nicht heraus. Die Schalter `RETAKE`/`MISS` bleiben im Code,
falls ein einheitliches Board (wie Robins Impasto-Style) es später lohnt.

## 6 · Tests (13.10.)

**dopamin** (24 Board-Bilder, 4 Familien: Textured Impasto, Graphic Gouache, Vibrant Impressionist, Decorative
Top-Down; Studie in 1,5 min). Set `mv6ol9a8-vk5co`.

- **Runde 1** (5 Bilder, je Stufe eins, erste Prompts): Panda im Bett (Subtle) fast perfekt; schwarze Katze in der
  Wanne (Minimal) stilecht, aber greller und mit Impasto-Wülsten (die Familien-Beschreibung „heavy impasto ridges“
  wurde übertrieben); Leopard mit Martini (Low) genau das Gefühl, etwas sauberer gemalt; Panda im Lotus-Pool
  (Medium) nur die Anker-Komposition mit anderem Tier und zu fein; Tiger hinter Streifenvorhang (High) kreativ und
  stilecht. Daraus: Familien-Text raus aus dem Maler-Prompt, Regeln gegen Verfeinern und für Tiere, Medium/High
  müssen Ort oder Tätigkeit wechseln, keine Detail-Wörter.
- **Runde 2** (15 Bilder, 3 je Stufe): nach meinem Urteil 10–11 von 13 fertigen Bildern Treffer (Spa-Pudel,
  Leopard mit Wein, Katze im Strandstuhl, Panda in der Wanne, Leopard mit Cowboyhut, Discokugel-Katze, Katze auf der
  Toilette, Tiger im Bademantel mit Kaugummi, Tiger mit Frühstück, gestapelte Köpfe), daneben: Zebra im Lotus-Pool
  (zu grafisch, Kopie des Pool-Motivs), Panda auf der Gartenparty (Kopie von Board-Bild 16 mit Panda), Tiger im Bett
  mit Händen (tolle Idee, Tiger zu detailliert).

**Vibrant Textured Impasto Whimsy** (20 Board-Bilder, Robins freigegebene Outputs, 2 Familien). Set
`mv6pocvx-7iqa8`: Ente in der Wanne (Minimal) und Walross auf dem Balkon (Subtle) mit identischer Hand; Schweine
beim Brunch (Low) im exakten Stil, aber fast Board-Bild 20 → Regel „keine Kombination, die schon auf dem Board ist“.
Ein einheitliches Board trifft Nano Banana deutlich genauer als ein gemischtes.

**Variants und Ideas ohne Style** (Robins Beispiele): die Katze (Minimal) bleibt jetzt selig mit geschlossenen
Augen, gleiche weiche Malweise, nur Sektflöte und Schleife neu. Tiger-Ideen: Gepard in der Wanne und Bär im Diner
(vor den Tier- und Detail-Wort-Regeln) noch zu voll und zu sauber; danach Jaguar am pinken Klavier (Medium) und
Schneeleopard im Beiwagen (High): Palette, lockere Hand und das ruhig-verspielte Gefühl nah am Original, nicht mehr
dunkel oder überladen wie der Löwe in der Bibliothek.

**Validierung mit dem Endstand** (5 dopamin-Bilder, je Stufe eins, plus 1 über den Button im Browser):
Champagner-Tiger als Geschwister der dicken Katze (Minimal), schwarze Katze im Outfit des Pudels (Subtle), zwei
Pandas mit Trauben im Bett der Pizza-Tiger (Low), Tiger beim Maskenritual vor dem Spiegel mit „treat yourself“
(Medium), Blick von unter dem Glastisch auf die Gartenparty und Tiger im pinken Flur durch die Tür (High): alle
sechs stilecht und eigenständig; Gemini gab trotzdem meist Stil 6–7.

**Robins Review währenddessen** (13:41–13:43 UTC): 13 freigegeben, darunter fünf, die Gemini mit Stil 5–6
durchfallen lassen wollte (Discokugel-Katze, Tigerbaby mit Torte, Panda auf der Gartenparty, Panda in der Wanne,
Katze auf der Toilette) — der Grund, warum nichts automatisch abgelehnt wird.

**Kosten der Tests:** 50 Bilder (dopamin 38 inklusive der verworfenen zweiten Versuche, Impasto 5, Katze 2,
Tiger 5), freigegeben waren 200.

## 7 · Bedienung

- Style öffnen → **Autonomous scale** → Anzahl (1–200), Stufen (Standard: alle fünf, gleichmäßig verteilt),
  Now oder Batch (halber Preis, für große Mengen über Nacht) → **Scale N posters**. Der Toast öffnet das Set.
- Im Set (Generation → Ordner „Styles“) liegt jede Runde als Gruppe „Autonomous scale“; links die Board-Bilder,
  ein Klick filtert auf die Poster eines Ankers. **Scale more** startet die nächste Runde, die alle bisherigen kennt.
- Review wie gewohnt; „Art direction“ zeigt Brief und Prüfnoten. Gute Bilder können per „Add to style“ wieder aufs
  Board, dann kennt die nächste Studie sie mit.
