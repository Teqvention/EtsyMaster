# Bild-Pipeline: Now, Batch, über Nacht — ohne Sperre

**Stand:** 15.10.2026. Alle Zahlen sind gemessen (Messläufe in dieser App, Vertex-Jobhistorie des Projekts,
Google Cloud Monitoring), sonst steht es dabei. Ergänzt das Wissen aus dem alten Projekt
(`google-bilder-batch-sync-wissen.md`).

## 1 · Das Wichtigste in fünf Sätzen

1. **Online („Now“) lässt Google für dieses Projekt nur etwa ein Nano-Banana-2.1-Bild pro Minute durch.**
   Mehr Parallelität bringt nur mehr Ablehnungen (429), und genau solche Ablehnungs-Stürme stehen im Verdacht,
   zur Sperre vom 10.10. geführt zu haben.
2. **Masse geht nur über Batch.** Wenige große Jobs, die Google bis zu 24 h lang abarbeitet, auch wenn der Laptop
   zugeklappt ist. Das ist für Google das unauffälligste Muster: 4 Aufrufe statt Tausender.
3. **Nano Banana 2.1 ist seit 6.10. auf dem Markt, halb so teuer wie Nano Banana 2 und gerade stark überlastet**
   (Batch-Jobs mit 49 Bildern: 2 h; online 20–168 s je Bild). Nano Banana 2 malte dieselben Anfragen in 14 s
   je Bild, und 10 Batch-Bilder in 15 min.
4. Die Pipeline nimmt deshalb **2.1 als Standard** und weicht **nur bei Überlastung** auf Nano Banana 2 aus
   (doppelter Preis nur für diese Bilder). Das Bild trägt dann die Marke „NB 2“.
5. **Keine zusätzlichen Google-Projekte oder Schlüssel, um Limits zu umgehen.** Online ist ein geteilter Topf für
   alle Kunden, ein weiteres Projekt fragt im selben vollen Topf. Und Limits über mehrere Projekte zu umgehen,
   ist genau das Muster, für das Google Projekte sperrt.

## 2 · Wie lange dauern 100 Bilder im Batch? (12.10.2026)

| Lauf | Code | Ergebnis |
|---|---|---|
| **A** · 10 Listings × (5 Varianten + 5 Ideen), Batch, Start 12:44 UTC | alt | 5 min: 6 · 10 min: 10 · 25 min: 25 Bilder, fast alle über die Online-Spur. Batch-Jobs wurden nach 13–15 min mit je 1–2 Bildern abgebrochen und neu eingereicht. Danach schlief der Mac 56 min. 95 von 100 nach 4 h. |
| **C** · 10 weitere Listings, gleiche Einstellungen, Start 14:28 UTC | neu | Neustart-Test nach 5 min: alle 10 Sets in 3 s automatisch wieder aufgenommen. Ein 2.1-Job mit 49 Bildern brauchte bei Google **122 min**; 58 Bilder nach 2,5 h. Der Rest lief in einen neuen Job. |
| Vertex-Historie (Nano Banana 2, Sep–Okt) | — | 120 Bilder in 11 min · 161 in 10 min · 202 in 8 min · 226 in 22 min; aber auch 21 in 4 h und 497 in 8 h |

**Fazit:** Wie lange ein Batch braucht, bestimmt Googles Auslastung, kaum die Größe. Heute: Nano Banana 2.1
rund 2 h je Job, Nano Banana 2 rund 15 min.

### Modellvergleich (gleiche Anfragen, byte-genau, 2K)

| | Nano Banana 2.1 | Nano Banana 2 |
|---|---|---|
| Modell-ID | `gemini-nano-banana-2.1` | `gemini-3.1-flash-image` |
| Preis je Bild 2K online / Batch | ≈ 0,05 $ / **0,025 $** | ≈ 0,10 $ / 0,05 $ |
| Zeit online (6 Anfragen) | 20–168 s, 11× abgelehnt | **14–16 s, 0× abgelehnt** |
| Batch (12.10.) | 49 Bilder: 122 min | **10 Bilder: 15 min** |
| Qualität | hält sich genauer an die Bildidee und an den Stil der Vorlage | dramatischer, realistischer; schrieb einmal ungefragt Text auf Bücher |

Bilder nebeneinander: Artefakt „Tiger-Modelltest“ (https://claude.ai/artifact/J2kT7k84AkgQ5chmNwRe3a).
Preise: Googles Preisliste (Bild-Tokens 30 $ bzw. 60 $ je Mio., Batch die Hälfte); laut LiteLLM schaltet die
Gemini API Nano Banana 2 am 29.10.2026 ab, für Vertex nicht bestätigt.

## 3 · So läuft ein Auftrag

```
Generate ──► Set je Listing: Foto holen → Poster finden → verstehen → Briefs schreiben   (Gemini Flash, 6 Sets parallel)
                 │
                 ├── Now ──► Online-Spur (2 gleichzeitig, Now vor Batch)
                 │             · 2.1 zweimal „busy“ → Nano Banana 2 malt das Bild
                 │             · was die Spur in ~10 min nicht schafft → Batch-Job; Überläufe mehrerer Sets
                 │               sammeln sich bis 30 s Ruhe (höchstens 2 min) und gehen in EINEN Job
                 │
                 └── Batch ─► Ausgang sammelt den Auftrag und schickt, sobald er fertig vorbereitet ist,
                               200 Bilder warten, 2 min nichts Neues kam oder spätestens nach 15 min
                               → EIN Job je Auftrag (bis 250 Bilder), größer: gleich große Teile
                               → höchstens 4 Jobs gleichzeitig (1 Platz bleibt für Now-Überlauf frei)
                               → Jobs starten mindestens 30 s nacheinander
                 ▼
          Abfrage alle 30 s → Ergebnis einsammeln → Bild speichern → Set fertig
          Selbstheilung jede Minute: Fehler mit vorübergehender Ursache neu (1, 3, 10, 20, 30 min, dann stündlich)
```

**Ziele je Job:** kleine Aufträge (bis 250 Bilder) 1 Stunde, große 8 Stunden (über Nacht). Ein Job wird nur
vorzeitig beendet (Fertiges kommt rein, der Rest geht neu raus), wenn er hängt, stockt oder deutlich hinter
seinem Ziel liegt. Ein 2.1-Job gibt seinen Rest dann an Nano Banana 2. Bis 12.10. wurden Jobs nach einem Bild und
4 Minuten Stillstand abgebrochen; der Rest fing in neuen Jobs immer wieder von vorn an.

## 4 · Sicherheit: was eine Sperre verhindert

| Regel | Wert | Warum |
|---|---|---|
| Gemeinsames Tempo aller Server (DB-Tabelle `google_pace`) | 2.1 online ≤ 4 Versuche/min · NB 2 ≤ 10/min · Flash ≤ 60/min · Batch-Jobs ≥ 30 s Abstand | egal wie viele Dev-Server laufen: Google sieht nie mehr |
| Gemeinsame Pause bei „busy“ (429) | 15 s, verdoppelt bis 60 s | kein Ablehnungs-Sturm (10.10.: 30+ Anfragen/s) |
| Online gleichzeitig | 2 je Server | mehr bringt bei Googles geteiltem Topf nichts |
| Batch-Jobs gleichzeitig | ≤ 4 | 7 gleichzeitig stauten sich (05.09.), 44 in 5 min gingen der Sperre voraus (10.10.) |
| **Abgelehnte Anfragen (400) werden nie wiederholt** | 5 in 10 min → Pause 15 min, beim 2. Mal 1 h, beim 3. Mal (binnen 6 h) bis du klickst | keine Schleife aus „falschen Anfragen“ |
| Verweigert (401/403: Sperre, Rechnung, Anmeldung, fehlende Bucket-Rechte) | 3 in 10 min → Pause, bis du klickst | weiterklopfen macht es nur schlimmer; Warten repariert keine Rechte |
| Safety-Filter hält Bilder zurück | 5 in 30 min (Batch: 10 % eines Jobs) → Pause 30 min, beim 2. Mal 2 h, beim 3. Mal (binnen 6 h) bis du klickst | die blockierten Bilder bleiben aussortiert, der Rest läuft weiter |
| Batch-Job nie doppelt anlegen | vor jedem neuen Versuch bei Google nachsehen | ein doppelter Auftrag ist doppelt bezahlt |
| Selbstheilung mit wachsendem Abstand | nach 1, 3, 10, 20, 30 min, dann stündlich; bis zu 40× je Set, 3 Tage lang | ein Auftrag über Nacht kommt durch, egal wie oft Google „busy“ war; höchstens 1 Versuch/h je Set |

Pausiert die App von selbst, steht der Grund in der Seitenleiste („Google paused · Paused by itself …“), bei einer
befristeten Pause mit „resumes by itself at …“. Eine unbefristete Pause (Verweigerung oder zu oft) endet erst mit
„Resume“.

### Sweet Spot (13.10.2026)

| Frage | Antwort | Beleg |
|---|---|---|
| Bilder je Batch-Job | **bis 250**; 400 Bilder = 2 Jobs à 200, beide sofort | NB 2: 161 Bilder 10 min, 202 in 8 min, 226 in 22 min; Dauer hängt kaum von der Größe ab; Google rät zu wenigen großen Jobs |
| Jobs gleichzeitig | **≤ 3 für Batch, 1 Platz frei für „Now“, nie mehr als 4** | 7 gleichzeitig stauten sich (05.09.) |
| Online gleichzeitig | **2** | 5 parallel: 14 von 20 abgelehnt |
| Modell | **2.1 zuerst, NB 2 übernimmt, wenn ein Job nach ⅓ seines Ziels unter der halben Erwartung liegt** (Robins Entscheidung 13.10.) | 2.1: 49 Bilder 122 min (überlastet seit Start 6.10.); NB 2: 10 Bilder 15 min |
| Kosten 400 Bilder (2K, Batch) | ≈ 10 $ mit 2.1, ≈ 20 $ mit NB 2; die Seitenleiste zeigt die Schätzung („≈ $…“) und die Restzeit („~… left“) | Google-Preisliste 13.10. |
| Was läuft gerade? | Die grüne Karte zeigt „2 jobs · 183 + 25“. Ein Klick listet **jeden Job einmal** (egal für wie viele Sets er malt): Größe, Modell (2.1 / NB 2), „148 of 183 painted at Google“ mit Balken, Dauer, nach dem Ende „164 back · 19 went on as a rest“; aufgeklappt die Sets darin | bis 15.10. stand dort eine Zeile je Set, ein Job über 20 Sets sah aus wie 20 kleine |

**Messung 13.10. (neues Projekt `robin-481512`, 185 Bilder, 2K, Klick „Send all“ um 12:40:49 UTC):**

| Zeit nach Klick | Was |
|---|---|
| 0:24 | **ein** Job mit 183 Bildern bei Google (2 gingen online), Modell 2.1 |
| 4:38 | Google beginnt zu malen (vorher Warteschlange) |
| 8:20 | 78 gemalt · 9:20 → 148 · 12:30 → 152 (**83 %**) |
| danach | nur noch ~1 Bild/min: die Nachzügler halten alles auf, und Vertex gibt Bilder erst am Job-Ende heraus |
| 31:00 | Job beendet (164 von 183); so spät nur, weil der Server 3000 mit altem Code den Job betreute, siehe unten |
| 33–36 | Abbrechen bei Vertex (~3 min), dann alle 164 in ~1,5 min eingesammelt, 0 Fehler |
| 36:36 | Rest (19) als NB 2-Batch-Job hinterher |

**Nachzügler-Regel (seit 15.10.):** Ein Job ab 40 Bildern wird nach 10 min beendet und eingesammelt, sobald er
80 % gemalt hat, oder 70 % und in den letzten 3 min weniger als 3 % dazukamen (der „Knick“: danach tröpfelt es
nur noch). Bis 60 Bilder Rest malt NB 2 **online** (zwei gleichzeitig, ~14 s je Bild), statt in einem neuen
Batch-Job eine halbe bis ganze Stunde zu warten. Für 60 bis 200 Bilder heißt das bei normaler Google-Last:
Job nach wenigen Sekunden bei Google, ~4–5 min Warteschlange dort, ~80 % gemalt nach ~10 min, Abbrechen ~3 min,
Einsammeln 1–3 min, also **~80 % sichtbar nach ~14–16 min**, der Rest online ~5–10 min später. Schneller geht es
nicht, solange Vertex Bilder erst am Job-Ende herausgibt. An einem überlasteten Abend (13.10.) dauert es
Stunden; das bestimmt Google, nicht die App.

**Messung 13.10. Bauhaus-Auftrag (24 City-Sets, 311 Bilder, ~14:38 UTC):** alle 311 fertig, 0 Fehler
(153× 2.1, 158× NB 2), aber erst am 14.10. um 10:47. Die Zeit ging fast ganz auf unserer Seite verloren:

| Was | Folge | Seit 15.10. |
|---|---|---|
| Uploads füllten die Leitung des Laptops (~500 MB: jedes Set lud Board und Referenzen neu hoch), Ping 2 s | DB nicht erreichbar 14:43–14:47 und 15:17–15:47 | jedes Referenzbild geht **einmal** hoch (`batch/img/<hash>.jpg`, für alle Sets und Aufträge); große Uploads höchstens 2 gleichzeitig und nur ~70 % der Zeit (`storage/uplink.ts`) |
| postgres.js-Fehler „reading 'write'“: Abfragen auf kaputten Verbindungen warteten für immer | Warteschlange stand still, bis der Server von Hand neu startete | **DB-Wächter** (`db/sql.ts`): fragt beide Pools alle 20 s; antwortet einer 3× nicht, eine frische Verbindung aber schon, wird er ersetzt, wartende Abfragen scheitern und heilen sich selbst |
| hängende Set-Läufe (erst nach 45 min freigegeben) hielten den Ausgang auf, der auf **alle** Sets wartete (bis 90 min) | erster Job erst nach 2 h 40 min | Läufe nach **10 min** Stillstand frei; der Ausgang schickt bei 200 Bildern, nach 2 min ohne Neues oder spätestens nach 15 min |
| NB 2-Jobs wurden nach 60 min beendet, obwohl sie noch lieferten; ihr Rest fing neu an | Rest-Runden bis 22:31 | NB 2-Jobs laufen weiter, solange sie liefern; der Nachzügler-Rest geht online |
| Server nachts weggefallen (Speicherdruck) | letzte 28 Bilder warteten bis zum Morgen | **`scripts/dev-leader.sh`** startet den Server sofort neu (mit frischem Turbopack-Cache) und hält den Mac am Ladekabel wach |

Nur **ein** Server steuert Google: seit 14.10. **3000** (`test`), gestartet mit `scripts/dev-leader.sh`; jeder
andere Server läuft mit `FOLLOWER=1`. Citys-„Now“-Bilder laufen seit 13.10. ebenfalls durch die gedrosselte
Online-Spur (mit Ausweichmodell und Überlauf in einen Batch-Job) statt jedes für sich.

## 5 · Tausende Bilder über Nacht

1. **Pilot zuerst** (Regel aus dem alten Projekt): 10 Bilder „Now“, jedes ansehen, Prompt/Einstellungen korrigieren.
2. **Abends** den großen Auftrag als **Batch** starten. Die App bereitet alles vor (100 Sets ≈ 20 min, 300 Sets
   ≈ 1 h) und schickt es dann in wenigen großen Jobs zu Google (z. B. 3000 Bilder = 3 Jobs à 1000).
3. Wenn in der Seitenleiste nichts mehr „wartet“ und nur noch Jobs laufen, **darf der Laptop schlafen**. Die Jobs
   laufen bei Google weiter. Besser: am Ladekabel lassen, dann hält `scripts/dev-leader.sh` ihn wach, und alles
   kommt herein, sobald es fertig ist.
4. **Morgens** den Laptop öffnen und die App laufen lassen: Sie sammelt alles ein (hängengebliebene Abfragen nach
   dem Schlaf startet die Selbstheilung neu), schickt Reste nach und zeigt am Ende, was fehlt.
5. Kosten (2K, Batch): 1000 Bilder ≈ 25 $ mit 2.1, ≈ 50 $ mit Nano Banana 2; 3000 Bilder ≈ 75–150 $.
   Ein Budget-Alarm in der Google Cloud Console kostet nichts.

**Grenzen:** Google verspricht Batch-Ergebnisse innerhalb von 24 h. An einem Tag wie dem 12.10. (2.1 neu und
überlastet) kann ein großer Auftrag die Nacht überdauern; dann übernimmt Nano Banana 2 den Rest, sobald ein Job
deutlich hinter seinem 8-Stunden-Ziel liegt.

## 6 · Strukturell und langfristig

1. **Hintergrundarbeit auf einen immer laufenden Server** (Dokploy, neben der Datenbank) statt auf den Laptop.
   Das löst Schlaf, wechselnde Leader-Server mit altem Code und volle Datenbank-Verbindungen. Die Dev-Server
   zeigen dann nur noch die Oberfläche.
2. **Worktrees immer mit `FOLLOWER=1`** starten. Am 12.10. hat ein Worktree-Server mit altem Code Jobs dieser App
   nach seinen alten Regeln abgebrochen.
3. **Datenbank-Verbindungen:** Jeder Dev-Server öffnet bis zu 42. Nach dem Schlaf des Macs blieben 43 tote
   Verbindungen liegen und die DB nahm keine neuen mehr an („too many clients“). Abhilfe: kleinere Pools, ein
   Connection-Pooler (PgBouncer) oder in Postgres `idle_session_timeout` für die App-Verbindungen.
4. **Ein Projekt, ein Rechnungskonto, kein Testguthaben** für Produktion. Für garantierte Online-Kapazität ist
   Googles offizieller Weg **Provisioned Throughput**, nicht weitere Projekte.
5. **Dauerhafte Aufgaben-Tabelle** (eine Zeile pro Bild mit Status, Versuchen, Lease) statt Warteschlangen im
   Arbeitsspeicher. Heute fängt die Selbstheilung Neustarts ab; eine Tabelle machte das von Grund auf robust.

## 7 · Wo es im Code steht

| Datei | Was |
|---|---|
| `src/lib/generation/run.ts` | Warteschlange, Online-Spur, Batch-Ausgang, Job-Regeln, Ausweichmodell, Selbstheilung |
| `src/lib/google/pace.ts` | gemeinsames Tempo aller Server (Tabelle `google_pace`) |
| `src/lib/google/pause.ts` | Pause-Schalter, selbstständige Pause bei Verweigerung, Ablehnung, Safety-Häufung |
| `src/lib/mockups/vertex-batch.ts` | Batch-Jobs, Referenzbilder je einmal hochgeladen, ein Online-Versuch je Bild (`paintLineOnce`) |
| `src/lib/db/sql.ts` | DB-Pools und der Wächter, der einen kaputten Pool ersetzt (`mend`) |
| `src/lib/storage/uplink.ts` | Upload-Drossel: höchstens 2 große Uploads, ~70 % der Leitung |
| `scripts/dev-leader.sh` | hält den führenden Dev-Server am Laufen und den Mac am Ladekabel wach |
| `src/lib/mockups/gemini.ts` | Anmeldung, Gemini-Aufrufe mit Geduld, Modelle (`PAINT_MODEL`, `FALLBACK_MODEL`) |
| `GET /api/generations/batch` | Zustand: Online-Spur, Ausgang, Uploads, ersetzte DB-Pools, Tempo-Töpfe, Selbstheilung, Probleme |
