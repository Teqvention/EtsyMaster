# Bild-Pipeline: Now, Batch, über Nacht — ohne Sperre

**Stand:** 12.10.2026. Alle Zahlen sind gemessen (Messläufe in dieser App, Vertex-Jobhistorie des Projekts,
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
                 │             · was die Spur in ~10 min nicht schafft → sofort in einen Batch-Job
                 │
                 └── Batch ─► Ausgang sammelt, bis der Auftrag fertig vorbereitet ist
                               → EIN Job je Auftrag (bis 250 Bilder), größer: gleich große Teile
                               → höchstens 4 Jobs gleichzeitig (1 Platz bleibt für Now-Überlauf frei)
                               → Jobs starten mindestens 30 s nacheinander
                 ▼
          Abfrage alle 30 s → Ergebnis einsammeln → Bild speichern → Set fertig
          Selbstheilung jede Minute: Fehler mit vorübergehender Ursache bis zu 4× neu (1, 3, 10, 20 min Abstand)
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
| **Abgelehnte Anfragen (400) werden nie wiederholt** | 5 in 10 min → alles pausiert | keine Schleife aus „falschen Anfragen“ |
| Verweigert (401/403: Sperre, Rechnung, Anmeldung) | 3 in 10 min → alles pausiert | weiterklopfen macht es nur schlimmer |
| Safety-Filter hält Bilder zurück | 5 in 30 min (Batch: 10 % eines Jobs) → alles pausiert | erst Prompts ansehen, dann weiter |
| Batch-Job nie doppelt anlegen | vor jedem neuen Versuch bei Google nachsehen | ein doppelter Auftrag ist doppelt bezahlt |
| Selbstheilung begrenzt | höchstens 4× je Set, nur für Sets der letzten 6 h | kein Endlos-Wiederholen |

Pausiert die App von selbst, steht der Grund in der Seitenleiste („Google paused · Paused by itself …“).
Weiter geht es erst, wenn du auf „Resume“ klickst.

## 5 · Tausende Bilder über Nacht

1. **Pilot zuerst** (Regel aus dem alten Projekt): 10 Bilder „Now“, jedes ansehen, Prompt/Einstellungen korrigieren.
2. **Abends** den großen Auftrag als **Batch** starten. Die App bereitet alles vor (100 Sets ≈ 20 min, 300 Sets
   ≈ 1 h) und schickt es dann in wenigen großen Jobs zu Google (z. B. 3000 Bilder = 3 Jobs à 1000).
3. Wenn in der Seitenleiste nichts mehr „wartet“ und nur noch Jobs laufen, **darf der Laptop schlafen**. Die Jobs
   laufen bei Google weiter.
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
| `src/lib/mockups/vertex-batch.ts` | Batch-Jobs, ein Online-Versuch je Bild (`paintLineOnce`) |
| `src/lib/mockups/gemini.ts` | Anmeldung, Gemini-Aufrufe mit Geduld, Modelle (`PAINT_MODEL`, `FALLBACK_MODEL`) |
| `GET /api/generations/batch` | Zustand: Online-Spur, Ausgang, Tempo-Töpfe, Selbstheilung, Probleme |
